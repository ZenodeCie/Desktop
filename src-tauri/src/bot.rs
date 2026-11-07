use std::collections::{HashMap, VecDeque};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

#[cfg(target_os = "windows")]
use parking_lot::Mutex;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use zeroize::Zeroize;

use crate::crypto;
use crate::error::{err, AppError, AppResult};
use crate::limits;
use crate::models::*;
use crate::paths::{is_valid_id, AppPaths};
use crate::runtime::RuntimeManager;
use crate::template;
use crate::vault::{atomic_write, restrict_permissions, Vault};

const MAX_LOG_LINES: usize = 3000;
const MAX_LOG_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const INSTALL_TIMEOUT_SECS: u64 = 300;

#[derive(Debug, Deserialize)]
pub struct CreateBotInput {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub auto_start: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct EditorAvailability {
    pub code: bool,
    pub cursor: bool,
}

struct Slot {
    info: RwLock<BotRuntimeInfo>,
    logs: RwLock<VecDeque<LogLine>>,
    seq: AtomicU64,
    stop_requested: AtomicBool,
    generation: AtomicU64,
    pid: AtomicU32,
    #[cfg(target_os = "windows")]
    _job: Mutex<Option<crate::limits::JobHandle>>,
}

impl Slot {
    fn new(id: &str) -> Self {
        Self {
            info: RwLock::new(BotRuntimeInfo {
                id: id.to_string(),
                status: BotStatus::Stopped,
                pid: None,
                exit_code: None,
                started_at: None,
                restarts: 0,
                last_error: None,
                discord_ready: false,
                cpu_percent: 0.0,
                memory_mb: 0.0,
                uptime_secs: 0,
            }),
            logs: RwLock::new(VecDeque::with_capacity(MAX_LOG_LINES)),
            seq: AtomicU64::new(1),
            stop_requested: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            pid: AtomicU32::new(0),
            #[cfg(target_os = "windows")]
            _job: Mutex::new(None),
        }
    }
}

#[derive(Serialize, Clone)]
struct LogEvent {
    bot_id: String,
    log: LogLine,
}

#[derive(Serialize, Clone)]
struct StatusEvent {
    bot_id: String,
    runtime: BotRuntimeInfo,
}

#[derive(Serialize, Clone)]
struct StatsEvent {
    bot_id: String,
    cpu_percent: f32,
    memory_mb: f64,
    uptime_secs: u64,
    discord_ready: bool,
}

pub struct BotManager {
    app: AppHandle,
    paths: AppPaths,
    vault: Arc<Vault>,
    runtime: Arc<RuntimeManager>,
    state: RwLock<State>,
    slots: RwLock<HashMap<String, Arc<Slot>>>,
    http: reqwest::Client,
}

impl BotManager {
    pub fn new(
        app: AppHandle,
        paths: AppPaths,
        vault: Arc<Vault>,
        runtime: Arc<RuntimeManager>,
    ) -> AppResult<Self> {
        let state = load_state(&paths.state_file)?;
        let manager = Self {
            app,
            paths,
            vault,
            runtime,
            state: RwLock::new(state),
            slots: RwLock::new(HashMap::new()),
            http: reqwest::Client::builder()
                .user_agent(format!("ZenodeHost/{}", env!("CARGO_PKG_VERSION")))
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
        };
        for bot in manager.state.read().bots.clone() {
            manager
                .slots
                .write()
                .insert(bot.id.clone(), Arc::new(Slot::new(&bot.id)));
        }
        Ok(manager)
    }

    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }

    pub fn runtime(&self) -> &RuntimeManager {
        &self.runtime
    }

    pub fn vault(&self) -> &Vault {
        &self.vault
    }

    pub fn settings(&self) -> Settings {
        self.state.read().settings.clone()
    }

    pub fn update_settings(&self, settings: Settings) -> AppResult<Settings> {
        let mut state = self.state.write();
        state.settings = settings;
        save_state(&self.paths.state_file, &state)?;
        Ok(state.settings.clone())
    }

    pub fn host_identity(&self) -> Option<HostIdentity> {
        self.state.read().host.clone()
    }

    pub fn set_host_identity(&self, host: HostIdentity) -> AppResult<()> {
        let mut state = self.state.write();
        state.host = Some(host);
        save_state(&self.paths.state_file, &state)
    }

    pub fn last_sync(&self) -> Option<String> {
        self.state.read().last_sync.clone()
    }

    pub fn mark_synced(&self) {
        let mut state = self.state.write();
        state.last_sync = Some(now_iso());
        let _ = save_state(&self.paths.state_file, &state);
    }

    pub fn list(&self) -> Vec<BotSummary> {
        let state = self.state.read();
        state
            .bots
            .iter()
            .map(|record| self.summary(record))
            .collect()
    }

    pub fn get(&self, id: &str) -> AppResult<BotSummary> {
        let record = self.record(id)?;
        Ok(self.summary(&record))
    }

    fn record(&self, id: &str) -> AppResult<BotRecord> {
        self.state
            .read()
            .bots
            .iter()
            .find(|bot| bot.id == id)
            .cloned()
            .ok_or_else(|| err("Bot introuvable"))
    }

    fn summary(&self, record: &BotRecord) -> BotSummary {
        let runtime = self
            .slots
            .read()
            .get(&record.id)
            .map(|slot| slot.info.read().clone())
            .unwrap_or_else(|| stopped_info(&record.id));
        BotSummary {
            record: record.clone(),
            runtime,
            has_token: self.has_token(&record.id),
        }
    }

    fn has_token(&self, id: &str) -> bool {
        self.vault.get(&token_key(id)).is_some()
    }

    pub fn create(&self, input: CreateBotInput) -> AppResult<BotSummary> {
        let name = input.name.trim().to_string();
        if name.len() < 2 || name.len() > 64 {
            return Err(err("Le nom doit contenir entre 2 et 64 caractères."));
        }
        let mut state = self.state.write();
        let id = unique_id(&name, &state.bots);
        let dir = self.paths.bot_dir(&id)?;
        template::ensure_template(&dir, &name)?;
        let now = now_iso();
        let record = BotRecord {
            id: id.clone(),
            name,
            description: input.description.trim().to_string(),
            origin: BotOrigin::Local,
            cluster_id: None,
            remote_bot_id: None,
            entry: "src/index.ts".to_string(),
            auto_start: input.auto_start,
            restart_policy: RestartPolicy::OnFailure,
            max_restarts: 8,
            memory_limit_mb: Some(state.settings.default_memory_limit_mb),
            catalog_slug: None,
            version: None,
            created_at: now.clone(),
            updated_at: now,
            owner: None,
            public_slug: None,
        };
        if let Some(token) = input
            .token
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
        {
            self.vault.set(&token_key(&id), token)?;
        }
        state.bots.push(record.clone());
        save_state(&self.paths.state_file, &state)?;
        drop(state);
        self.slots
            .write()
            .insert(id.clone(), Arc::new(Slot::new(&id)));
        Ok(self.summary(&record))
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        let record = self.record(id)?;
        let slot = self.slot(id);
        slot.stop_requested.store(true, Ordering::SeqCst);
        self.kill_if_running(&slot);
        let dir = self.paths.bot_dir(&record.id)?;
        if dir.exists() {
            std::fs::remove_dir_all(&dir)?;
        }
        let log_file = self.paths.logs_dir.join(format!("{}.log", record.id));
        let _ = std::fs::remove_file(log_file);
        let _ = self.vault.remove(&token_key(&record.id));
        let mut state = self.state.write();
        state.bots.retain(|bot| bot.id != record.id);
        save_state(&self.paths.state_file, &state)?;
        drop(state);
        self.slots.write().remove(&record.id);
        Ok(())
    }

    pub fn update_bot(&self, id: &str, patch: serde_json::Value) -> AppResult<BotSummary> {
        let mut state = self.state.write();
        let record = state
            .bots
            .iter_mut()
            .find(|bot| bot.id == id)
            .ok_or_else(|| err("Bot introuvable"))?;
        if let Some(name) = patch.get("name").and_then(|v| v.as_str()) {
            let name = name.trim();
            if name.len() >= 2 && name.len() <= 64 {
                record.name = name.to_string();
            }
        }
        if let Some(auto_start) = patch.get("auto_start").and_then(|v| v.as_bool()) {
            record.auto_start = auto_start;
        }
        if let Some(policy) = patch.get("restart_policy").and_then(|v| v.as_str()) {
            record.restart_policy = match policy {
                "always" => RestartPolicy::Always,
                "never" => RestartPolicy::Never,
                _ => RestartPolicy::OnFailure,
            };
        }
        if let Some(limit) = patch.get("memory_limit_mb").and_then(|v| v.as_u64()) {
            record.memory_limit_mb = Some(limit.clamp(128, 8192));
        }
        record.updated_at = now_iso();
        let record = record.clone();
        save_state(&self.paths.state_file, &state)?;
        drop(state);
        Ok(self.summary(&record))
    }

    pub fn set_token(&self, id: &str, token: &str) -> AppResult<()> {
        let token = token.trim();
        if token.len() < 50 {
            return Err(err("Ce jeton Discord semble invalide (trop court)."));
        }
        self.record(id)?;
        self.vault.set(&token_key(id), token)
    }

    pub fn clear_token(&self, id: &str) -> AppResult<()> {
        self.vault.remove(&token_key(id))
    }

    /// Télécharge et extrait le code source d'un bot de catalogue dans son
    /// dossier. Utilisé uniquement à la création : les éditions locales ne
    /// sont jamais écrasées par une mise à jour de catalogue.
    pub async fn install_source(self: &Arc<Self>, id: &str, url: &str) -> AppResult<()> {
        let record = self.record(id)?;
        let dir = self.paths.bot_dir(&record.id)?;
        std::fs::create_dir_all(&dir)?;
        self.download_source(&dir, url).await
    }

    fn slot(&self, id: &str) -> Arc<Slot> {
        if let Some(slot) = self.slots.read().get(id) {
            return slot.clone();
        }
        let slot = Arc::new(Slot::new(id));
        self.slots.write().insert(id.to_string(), slot.clone());
        slot
    }

    fn emit_status(&self, id: &str, slot: &Slot) {
        let _ = self.app.emit(
            "bot://status",
            StatusEvent {
                bot_id: id.to_string(),
                runtime: slot.info.read().clone(),
            },
        );
    }

    fn set_status(&self, slot: &Slot, status: BotStatus) {
        slot.info.write().status = status;
    }

    pub fn logs(&self, id: &str, limit: usize) -> Vec<LogLine> {
        self.slots
            .read()
            .get(id)
            .map(|slot| {
                let logs = slot.logs.read();
                logs.iter()
                    .rev()
                    .take(limit.clamp(1, MAX_LOG_LINES))
                    .cloned()
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect()
            })
            .unwrap_or_default()
    }

    fn append_log(&self, id: &str, slot: &Slot, stream: &str, line: String) {
        let trimmed = line.trim_end_matches(['\r', '\n']).to_string();
        if trimmed.is_empty() {
            return;
        }
        // Garde-fou : ne jamais relayer un secret même si un bot l'imprime.
        let safe = redact(&trimmed);
        let seq = slot.seq.fetch_add(1, Ordering::Relaxed);
        let log = LogLine {
            seq,
            ts: now_iso(),
            stream: stream.to_string(),
            line: safe.clone(),
        };
        {
            let mut logs = slot.logs.write();
            if logs.len() >= MAX_LOG_LINES {
                logs.pop_front();
            }
            logs.push_back(log.clone());
        }
        if stream == "stdout"
            && (safe.contains("connecté en tant que") || safe.contains("discord ready"))
        {
            slot.info.write().discord_ready = true;
        }
        self.write_log_file(id, &log);
        let _ = self.app.emit(
            "bot://log",
            LogEvent {
                bot_id: id.to_string(),
                log,
            },
        );
    }

    fn write_log_file(&self, id: &str, log: &LogLine) {
        let path = self.paths.logs_dir.join(format!("{id}.log"));
        if let Ok(meta) = std::fs::metadata(&path) {
            if meta.len() > MAX_LOG_FILE_BYTES {
                let _ = std::fs::rename(&path, path.with_extension("log.1"));
            }
        }
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            use std::io::Write;
            let _ = writeln!(file, "{} [{}] {}", log.ts, log.stream, log.line);
        }
    }

    fn kill_if_running(&self, slot: &Arc<Slot>) {
        let pid = slot.pid.load(Ordering::SeqCst);
        if pid > 0 {
            limits::kill_tree(pid, false);
            let slot = slot.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_secs(4)).await;
                let still = slot.pid.load(Ordering::SeqCst);
                if still == pid {
                    limits::kill_tree(pid, true);
                }
            });
        }
    }

    pub async fn start(self: &Arc<Self>, id: &str) -> AppResult<BotSummary> {
        self.start_internal(id, true).await
    }

    async fn start_internal(
        self: &Arc<Self>,
        id: &str,
        reset_restarts: bool,
    ) -> AppResult<BotSummary> {
        let record = self.record(id)?;
        let slot = self.slot(id);
        {
            let info = slot.info.read();
            if matches!(
                info.status,
                BotStatus::Starting | BotStatus::Running | BotStatus::Stopping
            ) {
                return Err(err("Le bot est déjà en cours d'exécution."));
            }
        }
        let runtime_bin = self.runtime.binary_path();
        limits::ensure_executable(&runtime_bin)?;
        let mut token = self
            .vault
            .get(&token_key(id))
            .ok_or_else(|| err("Aucun jeton Discord configuré pour ce bot."))?;

        let dir = self.paths.bot_dir(&record.id)?;
        std::fs::create_dir_all(&dir)?;
        if !dir.join("zenode.bot.json").exists() {
            template::ensure_template(&dir, &record.name)?;
        }
        let entry = if record.entry.is_empty() {
            "src/index.ts".to_string()
        } else {
            record.entry.clone()
        };
        if !dir.join(&entry).exists() {
            return Err(err(format!(
                "Fichier d'entrée introuvable : {entry}. Corrigez le manifeste du bot."
            )));
        }

        slot.stop_requested.store(false, Ordering::SeqCst);
        let generation = slot.generation.fetch_add(1, Ordering::SeqCst) + 1;
        {
            let mut info = slot.info.write();
            info.status = BotStatus::Starting;
            info.started_at = None;
            info.exit_code = None;
            info.last_error = None;
            info.discord_ready = false;
            if reset_restarts {
                info.restarts = 0;
            }
        }
        self.emit_status(id, &slot);

        if dir.join("package.json").exists() && !dir.join("node_modules").exists() {
            self.append_log(id, &slot, "system", "Installation des dépendances…".into());
            if let Err(error) = self.run_install(id, &slot, &dir, &runtime_bin).await {
                slot.info.write().status = BotStatus::Error;
                slot.info.write().last_error = Some(error.to_string());
                self.append_log(
                    id,
                    &slot,
                    "stderr",
                    format!("Installation impossible : {error}"),
                );
                self.emit_status(id, &slot);
                return Err(error);
            }
        }
        if slot.stop_requested.load(Ordering::SeqCst)
            || slot.generation.load(Ordering::SeqCst) != generation
        {
            self.set_status(&slot, BotStatus::Stopped);
            self.emit_status(id, &slot);
            return Err(err("Démarrage annulé."));
        }

        let mut cmd = Command::new(&runtime_bin);
        cmd.arg("run").arg(&entry);
        cmd.current_dir(&dir);
        self.configure_env(&mut cmd, &record, &token);
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(false);
        limits::prepare(&mut cmd, record.memory_limit_mb);

        let mut child = cmd
            .spawn()
            .map_err(|e| err(format!("Impossible de lancer le runtime : {e}")))?;
        token.zeroize();
        let pid = child.id().unwrap_or(0);
        slot.pid.store(pid, Ordering::SeqCst);
        #[cfg(target_os = "windows")]
        {
            if let Some(job) = limits::attach_job(&child, record.memory_limit_mb) {
                *slot._job.lock() = Some(job);
            }
        }
        {
            let mut info = slot.info.write();
            info.status = BotStatus::Running;
            info.pid = Some(pid);
            info.started_at = Some(now_iso());
            info.uptime_secs = 0;
        }
        self.append_log(
            id,
            &slot,
            "system",
            format!(
                "Processus lancé (PID {pid}) — runtime Bun {}",
                crate::runtime::BUN_VERSION
            ),
        );
        self.emit_status(id, &slot);

        self.spawn_readers(id.to_string(), slot.clone(), &mut child);
        self.spawn_waiter(id.to_string(), slot.clone(), child, generation);
        Ok(self.summary(&self.record(id)?))
    }

    fn configure_env(&self, cmd: &mut Command, record: &BotRecord, token: &str) {
        cmd.env_clear();
        let path = if cfg!(windows) {
            std::env::var("PATH")
                .unwrap_or_else(|_| r"C:\Windows\System32;C:\Windows;C:\Program Files".to_string())
        } else {
            "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin".to_string()
        };
        cmd.env("PATH", path);
        for key in [
            "HOME",
            "USERPROFILE",
            "TMPDIR",
            "TEMP",
            "TMP",
            "LANG",
            "LC_ALL",
        ] {
            if let Ok(value) = std::env::var(key) {
                cmd.env(key, value);
            }
        }
        cmd.env("NODE_ENV", "production");
        cmd.env("NO_COLOR", "1");
        cmd.env("ZENODE_BOT_ID", &record.id);
        cmd.env("ZENODE_BOT_NAME", &record.name);
        cmd.env(
            "ZENODE_HOST_ID",
            self.state
                .read()
                .host
                .as_ref()
                .map(|h| h.host_id.clone())
                .unwrap_or_else(|| "local".to_string()),
        );
        cmd.env("ZENODE_CORE_URL", &self.settings().core_url);
        cmd.env("ZENODE_RUNTIME_VERSION", crate::runtime::BUN_VERSION);
        cmd.env("BUN_INSTALL_CACHE_DIR", &self.paths.cache_dir);
        // Le jeton n'existe que dans l'environnement du processus enfant.
        cmd.env("DISCORD_TOKEN", token);
        cmd.env("BOT_TOKEN", token);
        cmd.env("BOT_NAME", &record.name);
        cmd.env("PREFIX", "!");
    }

    async fn run_install(
        self: &Arc<Self>,
        id: &str,
        slot: &Arc<Slot>,
        dir: &Path,
        runtime: &Path,
    ) -> AppResult<()> {
        let mut cmd = Command::new(runtime);
        cmd.arg("install").arg("--no-progress").current_dir(dir);
        cmd.env_clear();
        for key in [
            "HOME",
            "USERPROFILE",
            "PATH",
            "TMPDIR",
            "TEMP",
            "TMP",
            "LANG",
            "LC_ALL",
        ] {
            if let Ok(value) = std::env::var(key) {
                cmd.env(key, value);
            }
        }
        cmd.env("BUN_INSTALL_CACHE_DIR", &self.paths.cache_dir);
        cmd.env("NO_COLOR", "1");
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let output = tokio::time::timeout(Duration::from_secs(INSTALL_TIMEOUT_SECS), cmd.output())
            .await
            .map_err(|_| err("L'installation des dépendances a dépassé 5 minutes."))??;
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            self.append_log(id, slot, "install", line.to_string());
        }
        for line in String::from_utf8_lossy(&output.stderr).lines() {
            self.append_log(id, slot, "install", line.to_string());
        }
        if !output.status.success() {
            return Err(err(format!(
                "bun install a échoué (code {}). Vérifiez votre connexion ou package.json.",
                output.status.code().unwrap_or(-1)
            )));
        }
        if !dir.join("node_modules").exists() {
            return Err(err("Installation terminée mais node_modules est absent."));
        }
        Ok(())
    }

    fn spawn_readers(self: &Arc<Self>, id: String, slot: Arc<Slot>, child: &mut Child) {
        if let Some(stdout) = child.stdout.take() {
            let manager = self.clone();
            let bot_id = id.clone();
            let reader_slot = slot.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    manager.append_log(&bot_id, &reader_slot, "stdout", line);
                }
            });
        }
        if let Some(stderr) = child.stderr.take() {
            let manager = self.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    manager.append_log(&id, &slot, "stderr", line);
                }
            });
        }
    }

    fn spawn_waiter(
        self: &Arc<Self>,
        id: String,
        slot: Arc<Slot>,
        mut child: Child,
        generation: u64,
    ) {
        let manager = self.clone();
        tokio::spawn(async move {
            let status = child.wait().await;
            let code = status.as_ref().ok().and_then(|s| s.code());
            let success = status.as_ref().map(|s| s.success()).unwrap_or(false);
            if slot.generation.load(Ordering::SeqCst) != generation {
                return;
            }
            slot.pid.store(0, Ordering::SeqCst);
            #[cfg(target_os = "windows")]
            {
                *slot._job.lock() = None;
            }
            let stopped_by_user = slot.stop_requested.load(Ordering::SeqCst);
            {
                let mut info = slot.info.write();
                info.pid = None;
                info.exit_code = code;
                info.discord_ready = false;
                info.cpu_percent = 0.0;
                info.memory_mb = 0.0;
                info.status = if stopped_by_user || success {
                    BotStatus::Stopped
                } else {
                    BotStatus::Crashed
                };
                if !success && !stopped_by_user {
                    info.last_error = Some(format!(
                        "Le processus s'est arrêté avec le code {}.",
                        code.map(|c| c.to_string())
                            .unwrap_or_else(|| "inconnu".into())
                    ));
                }
            }
            manager.append_log(
                &id,
                &slot,
                if success { "system" } else { "stderr" },
                format!(
                    "Processus terminé (code {}).",
                    code.map(|c| c.to_string())
                        .unwrap_or_else(|| "inconnu".into())
                ),
            );
            manager.emit_status(&id, &slot);

            if stopped_by_user {
                return;
            }
            let policy = manager
                .record(&id)
                .map(|r| r.restart_policy.clone())
                .unwrap_or(RestartPolicy::Never);
            let should_restart = match policy {
                RestartPolicy::Always => true,
                RestartPolicy::OnFailure => !success,
                RestartPolicy::Never => false,
            };
            if !should_restart {
                return;
            }
            let (restarts, max) = {
                let mut info = slot.info.write();
                info.restarts += 1;
                (
                    info.restarts,
                    manager.record(&id).map(|r| r.max_restarts).unwrap_or(8),
                )
            };
            if restarts > max {
                slot.info.write().status = BotStatus::Error;
                slot.info.write().last_error =
                    Some(format!("Redémarrages automatiques épuisés ({max})."));
                manager.emit_status(&id, &slot);
                return;
            }
            let delay = (1u64 << restarts.min(5)).min(30);
            manager.append_log(
                &id,
                &slot,
                "system",
                format!("Redémarrage automatique dans {delay} s ({restarts}/{max})."),
            );
            slot.info.write().status = BotStatus::Stopped;
            manager.emit_status(&id, &slot);
            tokio::time::sleep(Duration::from_secs(delay)).await;
            if slot.stop_requested.load(Ordering::SeqCst) {
                return;
            }
            if let Err(error) = manager.start_internal(&id, false).await {
                manager.append_log(
                    &id,
                    &slot,
                    "stderr",
                    format!("Redémarrage impossible : {error}"),
                );
                slot.info.write().status = BotStatus::Error;
                slot.info.write().last_error = Some(error.to_string());
                manager.emit_status(&id, &slot);
            }
        });
    }

    pub async fn stop(self: &Arc<Self>, id: &str) -> AppResult<BotSummary> {
        let slot = self.slot(id);
        slot.stop_requested.store(true, Ordering::SeqCst);
        slot.generation.fetch_add(1, Ordering::SeqCst);
        let pid = slot.pid.load(Ordering::SeqCst);
        if pid == 0 {
            self.set_status(&slot, BotStatus::Stopped);
            slot.info.write().pid = None;
            self.emit_status(id, &slot);
            return self.get(id);
        }
        self.set_status(&slot, BotStatus::Stopping);
        self.emit_status(id, &slot);
        limits::kill_tree(pid, false);
        let manager = self.clone();
        let id_owned = id.to_string();
        let slot_clone = slot.clone();
        tokio::spawn(async move {
            for _ in 0..20 {
                if slot_clone.pid.load(Ordering::SeqCst) == 0 {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            if slot_clone.pid.load(Ordering::SeqCst) == pid {
                limits::kill_tree(pid, true);
                slot_clone.pid.store(0, Ordering::SeqCst);
                slot_clone.info.write().pid = None;
                slot_clone.info.write().status = BotStatus::Stopped;
                manager.emit_status(&id_owned, &slot_clone);
            }
        });
        {
            let mut info = slot.info.write();
            info.status = BotStatus::Stopping;
            info.discord_ready = false;
        }
        self.emit_status(id, &slot);
        self.get(id)
    }

    pub async fn restart(self: &Arc<Self>, id: &str) -> AppResult<BotSummary> {
        self.stop(id).await?;
        for _ in 0..30 {
            if self.slot(id).pid.load(Ordering::SeqCst) == 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        self.start(id).await
    }

    pub async fn start_autostart(self: &Arc<Self>) {
        if !self.runtime.status().installed {
            return;
        }
        let bots: Vec<BotRecord> = self
            .state
            .read()
            .bots
            .iter()
            .filter(|bot| bot.auto_start)
            .cloned()
            .collect();
        for bot in bots {
            let manager = self.clone();
            tokio::spawn(async move {
                let _ = manager.start(&bot.id).await;
            });
        }
    }

    pub fn apply_stats(&self, id: &str, cpu: f32, memory_mb: f64) {
        let Some(slot) = self.slots.read().get(id).cloned() else {
            return;
        };
        let uptime_secs = {
            let info = slot.info.read();
            info.started_at
                .as_deref()
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                .map(|start| {
                    (chrono::Utc::now() - start.with_timezone(&chrono::Utc))
                        .num_seconds()
                        .max(0) as u64
                })
                .unwrap_or(0)
        };
        {
            let mut info = slot.info.write();
            info.cpu_percent = cpu;
            info.memory_mb = memory_mb;
            info.uptime_secs = uptime_secs;
        }
        let _ = self.app.emit(
            "bot://stats",
            StatsEvent {
                bot_id: id.to_string(),
                cpu_percent: cpu,
                memory_mb,
                uptime_secs,
                discord_ready: slot.info.read().discord_ready,
            },
        );
    }

    /// Arrête tous les processus au moment de quitter l'application. Appelé de
    /// façon synchrone : l'arrêt gracieux est tenté, le reste est tué par
    /// `kill_tree` au prochain passage de la boucle de nettoyage.
    pub fn shutdown_all(&self) {
        let slots: Vec<Arc<Slot>> = self.slots.read().values().cloned().collect();
        for slot in slots {
            slot.stop_requested.store(true, Ordering::SeqCst);
            slot.generation.fetch_add(1, Ordering::SeqCst);
            let pid = slot.pid.load(Ordering::SeqCst);
            if pid > 0 {
                limits::kill_tree(pid, false);
            }
        }
    }

    pub fn running_snapshot(&self) -> Vec<(String, u32)> {
        self.slots
            .read()
            .iter()
            .filter_map(|(id, slot)| {
                let pid = slot.pid.load(Ordering::SeqCst);
                (pid > 0).then(|| (id.clone(), pid))
            })
            .collect()
    }

    pub fn host_stats(&self) -> serde_json::Value {
        let settings = self.state.read().settings.clone();
        let host = self.state.read().host.clone();
        let bots = self.list();
        json!({
            "settings": settings,
            "bots": bots.iter().map(|b| json!({
                "bot_id": b.record.id,
                "name": b.record.name,
                "status": b.runtime.status,
                "cpu_percent": b.runtime.cpu_percent,
                "memory_mb": b.runtime.memory_mb,
                "discord_ready": b.runtime.discord_ready,
                "cluster_id": b.record.cluster_id,
                "remote_bot_id": b.record.remote_bot_id,
            })).collect::<Vec<_>>(),
            "host": host,
        })
    }

    pub fn files(&self, id: &str) -> AppResult<Vec<FileEntry>> {
        let dir = canonical_bot_dir(&self.paths, id)?;
        let mut entries = Vec::new();
        let walker = ignore::WalkBuilder::new(&dir)
            .hidden(false)
            .git_ignore(true)
            .filter_entry(|entry| {
                let name = entry.file_name().to_string_lossy();
                !matches!(name.as_ref(), "node_modules" | "runtime.json" | ".git")
            })
            .build();
        for entry in walker.flatten() {
            let path = entry.path();
            if path == dir.as_path() {
                continue;
            }
            let Ok(relative) = path.strip_prefix(&dir) else {
                continue;
            };
            let relative = relative.to_string_lossy().replace('\\', "/");
            if relative.is_empty() {
                continue;
            }
            let metadata = match entry.metadata() {
                Ok(meta) => meta,
                Err(_) => continue,
            };
            entries.push(FileEntry {
                path: relative.clone(),
                name: entry.file_name().to_string_lossy().to_string(),
                is_dir: metadata.is_dir(),
                size: metadata.len(),
            });
            if entries.len() >= 2000 {
                break;
            }
        }
        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.path.to_lowercase().cmp(&b.path.to_lowercase()))
        });
        Ok(entries)
    }

    pub fn read_file(&self, id: &str, relative: &str) -> AppResult<String> {
        let path = safe_join(&canonical_bot_dir(&self.paths, id)?, relative)?;
        let meta = std::fs::metadata(&path)?;
        if !meta.is_file() {
            return Err(err("Ce chemin n'est pas un fichier."));
        }
        if meta.len() > MAX_FILE_BYTES {
            return Err(err("Fichier trop volumineux pour l'éditeur (max 2 Mo)."));
        }
        std::fs::read_to_string(&path).map_err(|_| err("Fichier binaire ou illisible en texte."))
    }

    pub fn write_file(&self, id: &str, relative: &str, contents: &str) -> AppResult<()> {
        if contents.len() as u64 > MAX_FILE_BYTES {
            return Err(err("Fichier trop volumineux (max 2 Mo)."));
        }
        let root = canonical_bot_dir(&self.paths, id)?;
        let path = safe_join(&root, relative)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        atomic_write(&path, contents.as_bytes(), false)?;
        Ok(())
    }

    pub fn editors(&self) -> EditorAvailability {
        EditorAvailability {
            code: which::which("code").is_ok(),
            cursor: which::which("cursor").is_ok(),
        }
    }

    pub fn open_folder(&self, id: &str) -> AppResult<()> {
        let dir = canonical_bot_dir(&self.paths, id)?;
        open_path(&dir.to_string_lossy())
    }

    pub fn open_editor(&self, id: &str, editor: &str) -> AppResult<()> {
        let dir = canonical_bot_dir(&self.paths, id)?;
        let cli = match editor {
            "code" => "code",
            "cursor" => "cursor",
            _ => return Err(err("Éditeur inconnu.")),
        };
        if let Ok(binary) = which::which(cli) {
            let status = std::process::Command::new(binary)
                .arg(&dir)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
            return status
                .map(|_| ())
                .map_err(|e| err(format!("Impossible de lancer {editor} : {e}")));
        }
        #[cfg(target_os = "macos")]
        {
            let app = if editor == "code" {
                "Visual Studio Code"
            } else {
                "Cursor"
            };
            let status = std::process::Command::new("open")
                .args(["-a", app, &dir.to_string_lossy()])
                .status();
            if status.map(|s| s.success()).unwrap_or(false) {
                return Ok(());
            }
            Err(err(format!(
                "{app} n'est pas installé. Installez la CLI `{editor}` ou l'application, puis réessayez."
            )))
        }
        #[cfg(not(target_os = "macos"))]
        Err(err(format!(
            "La commande `{editor}` est introuvable dans le PATH. Installez-la depuis l'éditeur, puis rouvrez ce panneau."
        )))
    }

    /// Installe une affectation de cluster. Le jeton est déchiffré localement
    /// puis conservé dans le coffre ; il n'est jamais écrit dans le dossier.
    pub async fn apply_assignment(self: &Arc<Self>, assignment: Assignment) -> AppResult<()> {
        let private_key = self
            .vault
            .get("host:private_key")
            .ok_or_else(|| err("Clé privée d'hôte absente. Reliez la machine au Core."))?;
        let token = crypto::open_sealed(&private_key, &assignment.sealed_token)?;
        let local_id = match self
            .state
            .read()
            .bots
            .iter()
            .find(|bot| bot.remote_bot_id.as_deref() == Some(assignment.bot_id.as_str()))
            .map(|bot| bot.id.clone())
        {
            Some(id) => id,
            None => sanitize_id(&assignment.bot_id),
        };
        let dir = self.paths.bot_dir(&local_id)?;
        let is_new = !dir.join("zenode.bot.json").exists();
        if is_new {
            std::fs::create_dir_all(&dir)?;
            if let Some(url) = assignment.source_url.as_deref() {
                if let Err(error) = self.download_source(&dir, url).await {
                    self.append_log(
                        &local_id,
                        &self.slot(&local_id),
                        "stderr",
                        format!("Téléchargement du code source impossible : {error}. Utilisation du modèle local."),
                    );
                }
            }
            if !dir.join("zenode.bot.json").exists() {
                template::ensure_template(&dir, &assignment.name)?;
            }
        }

        self.vault.set(&token_key(&local_id), token)?;
        let now = now_iso();
        let entry = assignment
            .entry
            .clone()
            .filter(|e| !e.trim().is_empty())
            .unwrap_or_else(|| "src/index.ts".to_string());
        let default_memory_limit_mb = self.state.read().settings.default_memory_limit_mb;
        {
            let mut state = self.state.write();
            if let Some(record) = state.bots.iter_mut().find(|bot| bot.id == local_id) {
                let previous_origin = record.origin.clone();
                record.name = assignment.name.clone();
                record.origin = if assignment.cluster_id.is_some() {
                    BotOrigin::Cluster
                } else {
                    previous_origin
                };
                record.cluster_id = assignment.cluster_id.clone();
                record.remote_bot_id = Some(assignment.bot_id.clone());
                record.public_slug = assignment.public_slug.clone();
                record.owner = assignment.owner.clone();
                record.entry = entry.clone();
                record.auto_start = true;
                record.memory_limit_mb = assignment.memory_limit_mb.or(record.memory_limit_mb);
                record.version = assignment.version.clone();
                record.updated_at = now.clone();
            } else {
                state.bots.push(BotRecord {
                    id: local_id.clone(),
                    name: assignment.name.clone(),
                    description: assignment
                        .cluster_name
                        .as_ref()
                        .map(|c| format!("Hébergé pour le cluster {c}"))
                        .unwrap_or_default(),
                    origin: if assignment.cluster_id.is_some() {
                        BotOrigin::Cluster
                    } else {
                        BotOrigin::Catalog
                    },
                    cluster_id: assignment.cluster_id.clone(),
                    remote_bot_id: Some(assignment.bot_id.clone()),
                    entry,
                    auto_start: true,
                    restart_policy: RestartPolicy::OnFailure,
                    max_restarts: 8,
                    memory_limit_mb: assignment.memory_limit_mb.or(Some(default_memory_limit_mb)),
                    catalog_slug: None,
                    version: assignment.version.clone(),
                    created_at: now.clone(),
                    updated_at: now,
                    owner: assignment.owner.clone(),
                    public_slug: assignment.public_slug.clone(),
                });
            }
            save_state(&self.paths.state_file, &state)?;
        }
        self.slots
            .write()
            .entry(local_id.clone())
            .or_insert_with(|| Arc::new(Slot::new(&local_id)));
        self.append_log(
            &local_id,
            &self.slot(&local_id),
            "system",
            format!(
                "Affectation reçue du cluster (bot distant {})",
                assignment.bot_id
            ),
        );
        let manager = self.clone();
        tokio::spawn(async move {
            let _ = manager.start(&local_id).await;
        });
        Ok(())
    }

    pub async fn detach_remote(&self, remote_bot_id: &str) -> AppResult<()> {
        let Some(record) = self
            .state
            .read()
            .bots
            .iter()
            .find(|bot| bot.remote_bot_id.as_deref() == Some(remote_bot_id))
            .cloned()
        else {
            return Ok(());
        };
        let slot = self.slot(&record.id);
        slot.stop_requested.store(true, Ordering::SeqCst);
        slot.generation.fetch_add(1, Ordering::SeqCst);
        self.kill_if_running(&slot);
        let mut state = self.state.write();
        if let Some(bot) = state.bots.iter_mut().find(|bot| bot.id == record.id) {
            bot.cluster_id = None;
            bot.auto_start = false;
            bot.updated_at = now_iso();
        }
        save_state(&self.paths.state_file, &state)?;
        Ok(())
    }

    async fn download_source(&self, dir: &Path, url: &str) -> AppResult<()> {
        if !url.starts_with("https://") {
            return Err(err("URL de code source non sécurisée (HTTPS requis)."));
        }
        let response = self.http.get(url).send().await?;
        if !response.status().is_success() {
            return Err(err(format!(
                "HTTP {} lors du téléchargement",
                response.status().as_u16()
            )));
        }
        if let Some(length) = response.content_length() {
            if length > 50 * 1024 * 1024 {
                return Err(err("Archive de bot trop volumineuse (max 50 Mo)."));
            }
        }
        let bytes = response.bytes().await?;
        if bytes.len() > 50 * 1024 * 1024 {
            return Err(err("Archive de bot trop volumineuse (max 50 Mo)."));
        }
        let tmp = self
            .paths
            .cache_dir
            .join(format!("source-{}.zip", uuid::Uuid::new_v4()));
        std::fs::write(&tmp, &bytes)?;
        let result = extract_zip(&tmp, dir);
        let _ = std::fs::remove_file(&tmp);
        result
    }
}

fn redact(line: &str) -> String {
    // Un token Discord a trois segments séparés par des points. On masque tout
    // motif qui y ressemble, même si un bot l'imprime par erreur (y compris
    // précédé d'un préfixe comme `token=` ou entouré de guillemets).
    fn allowed(c: char) -> bool {
        c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')
    }
    let mut out = String::with_capacity(line.len());
    for word in line.split_inclusive(char::is_whitespace) {
        let trailing_start = word
            .char_indices()
            .rev()
            .find(|(_, c)| !c.is_whitespace())
            .map(|(i, c)| i + c.len_utf8())
            .unwrap_or(0);
        let (body, trailing) = word.split_at(trailing_start);
        let mut cursor = 0usize;
        let mut run_start: Option<usize> = None;
        let emit = |out: &mut String, cursor: &mut usize, run: Option<usize>, end: usize| {
            let start = match run {
                Some(start) => start,
                None => return,
            };
            let candidate = &body[start..end];
            let dots = candidate.matches('.').count();
            out.push_str(&body[*cursor..start]);
            if dots == 2 && candidate.len() > 50 {
                out.push_str("[jeton masqué]");
            } else {
                out.push_str(candidate);
            }
            *cursor = end;
        };
        for (idx, c) in body.char_indices() {
            if allowed(c) {
                run_start.get_or_insert(idx);
            } else if let Some(start) = run_start.take() {
                emit(&mut out, &mut cursor, Some(start), idx);
            }
        }
        emit(&mut out, &mut cursor, run_start, body.len());
        out.push_str(&body[cursor..]);
        out.push_str(trailing);
    }
    out
}

fn token_key(id: &str) -> String {
    format!("bot:{id}:token")
}

fn stopped_info(id: &str) -> BotRuntimeInfo {
    BotRuntimeInfo {
        id: id.to_string(),
        status: BotStatus::Stopped,
        pid: None,
        exit_code: None,
        started_at: None,
        restarts: 0,
        last_error: None,
        discord_ready: false,
        cpu_percent: 0.0,
        memory_mb: 0.0,
        uptime_secs: 0,
    }
}

fn load_state(path: &Path) -> AppResult<State> {
    if !path.exists() {
        return Ok(State::default());
    }
    let raw = std::fs::read_to_string(path)?;
    if raw.trim().is_empty() {
        return Ok(State::default());
    }
    let mut state: State = serde_json::from_str(&raw)?;
    if state.settings.core_url.trim().is_empty() {
        state.settings.core_url = "https://zenode.fr".to_string();
    }
    Ok(state)
}

fn save_state(path: &Path, state: &State) -> AppResult<()> {
    let raw = serde_json::to_vec_pretty(state)?;
    atomic_write(path, &raw, true)
}

fn unique_id(name: &str, bots: &[BotRecord]) -> String {
    let base = {
        let mut slug = String::new();
        let mut last_dash = false;
        for c in name.chars() {
            if c.is_ascii_alphanumeric() {
                slug.push(c.to_ascii_lowercase());
                last_dash = false;
            } else if !last_dash && !slug.is_empty() {
                slug.push('-');
                last_dash = true;
            }
            if slug.len() >= 32 {
                break;
            }
        }
        let trimmed = slug.trim_matches('-').to_string();
        if trimmed.is_empty() {
            "bot".to_string()
        } else {
            trimmed
        }
    };
    for _ in 0..50 {
        let suffix = uuid::Uuid::new_v4().simple().to_string();
        let id = format!("{base}-{}", &suffix[..4]);
        if !bots.iter().any(|bot| bot.id == id) {
            return id;
        }
    }
    format!("bot-{}", uuid::Uuid::new_v4().simple())
}

fn sanitize_id(value: &str) -> String {
    let mut out = String::new();
    for c in value.chars() {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
            out.push(c.to_ascii_lowercase());
        } else {
            out.push('-');
        }
        if out.len() >= 48 {
            break;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() || !is_valid_id(&trimmed) {
        format!("remote-{}", &uuid::Uuid::new_v4().simple().to_string()[..8])
    } else {
        trimmed
    }
}

fn canonical_bot_dir(paths: &AppPaths, id: &str) -> AppResult<PathBuf> {
    let dir = paths.bot_dir(id)?;
    if !dir.exists() {
        return Err(err("Ce bot n'a pas de dossier local."));
    }
    dir.canonicalize().map_err(AppError::Io)
}

fn safe_join(root: &Path, relative: &str) -> AppResult<PathBuf> {
    let candidate = Path::new(relative);
    if candidate.is_absolute() {
        return Err(err("Chemin absolu interdit."));
    }
    if candidate.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(err("Chemin hors du dossier du bot."));
    }
    let joined = root.join(candidate);
    let parent = joined.parent().unwrap_or(root);
    let canonical_parent = parent
        .canonicalize()
        .unwrap_or_else(|_| parent.to_path_buf());
    if !canonical_parent.starts_with(root) {
        return Err(err("Chemin hors du dossier du bot."));
    }
    Ok(joined)
}

fn extract_zip(archive: &Path, destination: &Path) -> AppResult<()> {
    let file = std::fs::File::open(archive)?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| err("Archive ZIP invalide"))?;
    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|_| err("Archive ZIP illisible"))?;
        let Some(relative) = entry.enclosed_name() else {
            continue;
        };
        if relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            continue;
        }
        let target = destination.join(&relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if entry.size() > 10 * 1024 * 1024 {
            continue;
        }
        let mut output = std::fs::File::create(&target)?;
        std::io::copy(&mut entry, &mut output)?;
        restrict_permissions(&target, false)?;
    }
    Ok(())
}

fn open_path(path: &str) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(path).spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer").arg(path).spawn();
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let result = std::process::Command::new("xdg-open").arg(path).spawn();
    result
        .map(|_| ())
        .map_err(|e| err(format!("Impossible d'ouvrir le dossier : {e}")))
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Utilisé par la synchronisation Core pour vérifier qu'un identifiant distant
/// ne peut pas créer un dossier hors du répertoire bots.
pub fn safe_remote_id(value: &str) -> String {
    sanitize_id(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_discord_like_tokens() {
        let token = format!("{}.{}.{}", "A".repeat(24), "B".repeat(6), "C".repeat(30));
        let line = format!("token={token} fin");
        let cleaned = redact(&line);
        assert!(cleaned.contains("[jeton masqué]"));
        assert!(!cleaned.contains(&token));
    }

    #[test]
    fn keeps_regular_lines() {
        assert_eq!(redact("hello world"), "hello world");
    }

    #[test]
    fn unique_ids_are_valid_and_distinct() {
        let bots = vec![];
        let a = unique_id("Mon Bot !", &bots);
        let b = unique_id("Mon Bot !", &bots);
        assert!(is_valid_id(&a));
        assert_ne!(a, b);
    }

    #[test]
    fn remote_ids_are_sanitized() {
        assert_eq!(safe_remote_id("#123"), "123");
        assert!(is_valid_id(&safe_remote_id("a/b../c")));
    }
}
