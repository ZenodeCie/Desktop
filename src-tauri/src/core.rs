use std::sync::Arc;
use std::time::Duration;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::bot::{safe_remote_id, BotManager};
use crate::crypto;
use crate::error::{err, AppResult};
use crate::models::*;
use crate::vault::Vault;

#[derive(Debug, Deserialize)]
pub struct PairStartResponse {
    pub user_code: String,
    pub verification_uri: String,
    pub device_code: String,
    pub expires_in: u64,
    #[serde(default)]
    pub interval: u64,
}

#[derive(Debug, Deserialize)]
pub struct PairPollResponse {
    pub status: String,
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub user: Option<CoreUser>,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_at: String,
}

#[derive(Debug, Deserialize)]
pub struct RegisterHostResponse {
    pub host_id: String,
    pub machine_id: String,
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct HostHeartbeatPayload {
    host_id: String,
    version: String,
    cpu_percent: f64,
    memory_used_mb: f64,
    memory_total_mb: f64,
    capacity: u32,
    bots: Vec<Value>,
}

pub struct CoreClient {
    vault: Arc<Vault>,
    http: reqwest::Client,
    core_url: RwLock<String>,
}

impl CoreClient {
    pub fn new(vault: Arc<Vault>, core_url: String) -> Self {
        Self {
            vault,
            http: reqwest::Client::builder()
                .user_agent(format!("ZenodeHost/{}", env!("CARGO_PKG_VERSION")))
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
            core_url: RwLock::new(normalize_core_url(&core_url)),
        }
    }

    pub fn set_core_url(&self, url: &str) -> AppResult<()> {
        let normalized = normalize_core_url(url);
        if !(normalized.starts_with("https://")
            || normalized.starts_with("http://127.0.0.1")
            || normalized.starts_with("http://localhost"))
        {
            return Err(err(
                "L'URL du Core doit utiliser HTTPS (HTTP est accepté uniquement en local).",
            ));
        }
        *self.core_url.write() = normalized;
        Ok(())
    }

    pub fn core_url(&self) -> String {
        self.core_url.read().clone()
    }

    pub fn access_token(&self) -> Option<String> {
        self.vault.get("auth:access_token")
    }

    pub fn refresh_token(&self) -> Option<String> {
        self.vault.get("auth:refresh_token")
    }

    pub fn expires_at(&self) -> Option<String> {
        self.vault.get("auth:expires_at")
    }

    pub fn auth_state(&self) -> AuthState {
        let user = self
            .vault
            .get("auth:user")
            .and_then(|raw| serde_json::from_str::<CoreUser>(&raw).ok());
        let device_id = self.vault.get("auth:device_id");
        let host_id = self
            .vault
            .get("host:host_id")
            .or_else(|| self.vault.get("auth:host_id"));
        AuthState {
            authenticated: self.refresh_token().is_some(),
            user,
            device_id,
            host_id,
            expires_at: self.expires_at(),
        }
    }

    pub fn is_authenticated(&self) -> bool {
        self.refresh_token().is_some()
    }

    fn store_tokens(
        &self,
        access: &str,
        refresh: &str,
        expires_at: &str,
        device_id: Option<&str>,
    ) -> AppResult<()> {
        self.vault.set("auth:access_token", access)?;
        self.vault.set("auth:refresh_token", refresh)?;
        self.vault.set("auth:expires_at", expires_at)?;
        if let Some(device_id) = device_id {
            self.vault.set("auth:device_id", device_id)?;
        }
        Ok(())
    }

    fn ensure_keys(&self) -> AppResult<String> {
        if let Some(public) = self.vault.get("host:public_key") {
            return Ok(public);
        }
        let (secret, public) = crypto::generate_keypair();
        self.vault.set("host:private_key", secret)?;
        self.vault.set("host:public_key", &public)?;
        Ok(public)
    }

    pub fn machine_id(&self) -> AppResult<String> {
        if let Some(id) = self.vault.get("host:machine_id") {
            return Ok(id);
        }
        let id = format!("m_{}", uuid::Uuid::new_v4().simple());
        self.vault.set("host:machine_id", &id)?;
        Ok(id)
    }

    fn http_client(&self) -> &reqwest::Client {
        &self.http
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.core_url.read().trim_end_matches('/'), path)
    }

    pub async fn start_pairing(&self, device_name: String) -> AppResult<PairingInfo> {
        let public_key = self.ensure_keys()?;
        let machine_id = self.machine_id()?;
        let payload = json!({
            "device_name": device_name,
            "machine_id": machine_id,
            "platform": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "app_version": env!("CARGO_PKG_VERSION"),
            "public_key": public_key,
        });
        let response = self
            .http_client()
            .post(self.url("/api/desktop/v1/pair/start"))
            .json(&payload)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(http_error(response).await);
        }
        let body: PairStartResponse = response.json().await?;
        self.vault.set("auth:device_code", &body.device_code)?;
        Ok(PairingInfo {
            user_code: body.user_code,
            verification_uri: body.verification_uri,
            expires_at: chrono::Utc::now()
                .checked_add_signed(chrono::Duration::seconds(body.expires_in as i64))
                .map(|d| d.to_rfc3339())
                .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
            interval_secs: body.interval.max(2),
        })
    }

    pub async fn poll_pairing(&self) -> AppResult<PairPollResponse> {
        let device_code = self
            .vault
            .get("auth:device_code")
            .ok_or_else(|| err("Aucune demande de liaison en cours."))?;
        let response = self
            .http_client()
            .post(self.url("/api/desktop/v1/pair/poll"))
            .json(&json!({ "device_code": device_code }))
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(http_error(response).await);
        }
        let mut body: PairPollResponse = response.json().await?;
        if body.status == "approved" {
            if let (Some(access), Some(refresh), Some(expires)) = (
                body.access_token.as_deref(),
                body.refresh_token.as_deref(),
                body.expires_at.as_deref(),
            ) {
                self.store_tokens(access, refresh, expires, body.device_id.as_deref())?;
                if let Some(user) = &body.user {
                    self.vault.set("auth:user", serde_json::to_string(user)?)?;
                }
                self.vault.remove("auth:device_code")?;
                // La réponse contient des jetons : on ne les renvoie jamais à l'UI.
                body.access_token = None;
                body.refresh_token = None;
            }
        }
        Ok(body)
    }

    pub async fn refresh_access(&self) -> AppResult<()> {
        let refresh = self
            .refresh_token()
            .ok_or_else(|| err("Session expirée. Reliez à nouveau l'application."))?;
        let response = self
            .http_client()
            .post(self.url("/api/desktop/v1/token/refresh"))
            .json(&json!({ "refresh_token": refresh }))
            .send()
            .await?;
        if !response.status().is_success() {
            self.clear_session();
            return Err(err(
                "Session expirée. Reliez l'application à votre compte Zenode.",
            ));
        }
        let tokens: TokenResponse = response.json().await?;
        self.store_tokens(
            &tokens.access_token,
            &tokens.refresh_token,
            &tokens.expires_at,
            None,
        )
    }

    pub async fn authorized(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> AppResult<Value> {
        for attempt in 0..2 {
            let access = self
                .access_token()
                .ok_or_else(|| err("Non connecté au Core."))?;
            let mut request = self
                .http_client()
                .request(method.clone(), self.url(path))
                .bearer_auth(&access);
            if let Some(body) = &body {
                request = request.json(body);
            }
            let response = request.send().await?;
            if response.status() == reqwest::StatusCode::UNAUTHORIZED && attempt == 0 {
                self.refresh_access().await?;
                continue;
            }
            if !response.status().is_success() {
                return Err(http_error(response).await);
            }
            if response.status() == reqwest::StatusCode::NO_CONTENT {
                return Ok(Value::Null);
            }
            let text = response.text().await?;
            if text.trim().is_empty() {
                return Ok(Value::Null);
            }
            return Ok(serde_json::from_str(&text).unwrap_or(Value::String(text)));
        }
        Err(err("Authentification refusée par le Core."))
    }

    pub async fn me(&self) -> AppResult<Value> {
        self.authorized(reqwest::Method::GET, "/api/desktop/v1/me", None)
            .await
    }

    pub async fn register_host(&self, name: &str) -> AppResult<HostIdentity> {
        let public_key = self.ensure_keys()?;
        let machine_id = self.machine_id()?;
        let payload = json!({
            "machine_id": machine_id,
            "name": name,
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "public_key": public_key,
            "app_version": env!("CARGO_PKG_VERSION"),
            "capacity": 4u32,
        });
        let value = self
            .authorized(
                reqwest::Method::POST,
                "/api/desktop/v1/hosts/register",
                Some(payload),
            )
            .await?;
        let response: RegisterHostResponse = serde_json::from_value(value)
            .map_err(|_| err("Réponse d'enregistrement d'hôte invalide."))?;
        let identity = HostIdentity {
            host_id: response.host_id.clone(),
            machine_id: response.machine_id,
            name: if response.name.is_empty() {
                name.to_string()
            } else {
                response.name
            },
            public_key,
            registered_at: chrono::Utc::now().to_rfc3339(),
        };
        self.vault.set("host:host_id", &identity.host_id)?;
        self.vault.set("auth:host_id", &identity.host_id)?;
        Ok(identity)
    }

    pub async fn heartbeat(
        &self,
        host_id: &str,
        cpu: f64,
        memory_used_mb: f64,
        memory_total_mb: f64,
        capacity: u32,
        bots: Vec<Value>,
    ) -> AppResult<HeartbeatResult> {
        let payload = HostHeartbeatPayload {
            host_id: host_id.to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            cpu_percent: cpu,
            memory_used_mb,
            memory_total_mb,
            capacity,
            bots,
        };
        let value = self
            .authorized(
                reqwest::Method::POST,
                "/api/desktop/v1/hosts/heartbeat",
                Some(serde_json::to_value(payload)?),
            )
            .await?;
        serde_json::from_value(value).map_err(|_| err("Réponse de heartbeat invalide."))
    }

    pub async fn list_clusters(&self) -> AppResult<Vec<ClusterSummary>> {
        let value = self
            .authorized(reqwest::Method::GET, "/api/desktop/v1/clusters", None)
            .await?;
        Ok(serde_json::from_value(value).unwrap_or_default())
    }

    pub async fn cluster_detail(&self, cluster_id: &str) -> AppResult<ClusterDetail> {
        let value = self
            .authorized(
                reqwest::Method::GET,
                &format!("/api/desktop/v1/clusters/{cluster_id}"),
                None,
            )
            .await?;
        serde_json::from_value(value).map_err(|_| err("Détail du cluster invalide."))
    }

    pub async fn create_cluster(
        &self,
        name: &str,
        visibility: &str,
        description: &str,
    ) -> AppResult<Value> {
        self.authorized(
            reqwest::Method::POST,
            "/api/desktop/v1/clusters",
            Some(json!({
                "name": name,
                "visibility": visibility,
                "description": description,
            })),
        )
        .await
    }

    pub async fn join_cluster(&self, code: &str) -> AppResult<Value> {
        self.authorized(
            reqwest::Method::POST,
            "/api/desktop/v1/clusters/join",
            Some(json!({ "code": code })),
        )
        .await
    }

    pub async fn leave_cluster(&self, cluster_id: &str) -> AppResult<Value> {
        self.authorized(
            reqwest::Method::POST,
            &format!("/api/desktop/v1/clusters/{cluster_id}/leave"),
            None,
        )
        .await
    }

    pub async fn create_invite(&self, cluster_id: &str) -> AppResult<Value> {
        self.authorized(
            reqwest::Method::POST,
            &format!("/api/desktop/v1/clusters/{cluster_id}/invites"),
            None,
        )
        .await
    }

    pub async fn delete_cluster(&self, cluster_id: &str) -> AppResult<Value> {
        self.authorized(
            reqwest::Method::DELETE,
            &format!("/api/desktop/v1/clusters/{cluster_id}"),
            None,
        )
        .await
    }

    pub async fn deploy_bot(&self, cluster_id: &str, payload: Value) -> AppResult<Value> {
        self.authorized(
            reqwest::Method::POST,
            &format!("/api/desktop/v1/clusters/{cluster_id}/deploy"),
            Some(payload),
        )
        .await
    }

    pub async fn remove_cluster_bot(&self, cluster_id: &str, bot_id: &str) -> AppResult<Value> {
        self.authorized(
            reqwest::Method::DELETE,
            &format!("/api/desktop/v1/clusters/{cluster_id}/bots/{bot_id}"),
            None,
        )
        .await
    }

    pub async fn assign_bot(
        &self,
        cluster_id: &str,
        bot_id: &str,
        host_id: Option<&str>,
    ) -> AppResult<Value> {
        self.authorized(
            reqwest::Method::POST,
            &format!("/api/desktop/v1/clusters/{cluster_id}/bots/{bot_id}/assign"),
            Some(json!({ "host_id": host_id })),
        )
        .await
    }

    pub async fn report_bot(
        &self,
        cluster_id: &str,
        bot_id: &str,
        reason: &str,
    ) -> AppResult<Value> {
        self.authorized(
            reqwest::Method::POST,
            &format!("/api/desktop/v1/clusters/{cluster_id}/bots/{bot_id}/report"),
            Some(json!({ "reason": reason })),
        )
        .await
    }

    pub async fn block_bot(
        &self,
        cluster_id: &str,
        bot_id: &str,
        reason: &str,
    ) -> AppResult<Value> {
        self.authorized(
            reqwest::Method::POST,
            &format!("/api/desktop/v1/clusters/{cluster_id}/bots/{bot_id}/block"),
            Some(json!({ "reason": reason })),
        )
        .await
    }

    pub async fn catalog(&self) -> AppResult<Vec<CatalogBot>> {
        let value = self
            .authorized(reqwest::Method::GET, "/api/desktop/v1/catalog", None)
            .await?;
        Ok(serde_json::from_value(value).unwrap_or_default())
    }

    pub async fn check_update(&self, platform: &str, arch: &str) -> AppResult<Option<UpdateInfo>> {
        let current = env!("CARGO_PKG_VERSION");
        let response = self
            .http_client()
            .get(self.url(&format!(
                "/api/desktop/v1/updates/check?platform={platform}&arch={arch}&version={current}"
            )))
            .send()
            .await?;
        if !response.status().is_success() {
            return Ok(None);
        }
        let value: Value = response.json().await.unwrap_or(Value::Null);
        if value.get("update").and_then(|v| v.as_bool()) != Some(true) {
            return Ok(None);
        }
        serde_json::from_value(value)
            .map(Some)
            .map_err(|_| err("Manifeste de mise à jour invalide."))
    }

    pub async fn revoke(&self) {
        if let Some(refresh) = self.refresh_token() {
            let _ = self
                .http_client()
                .post(self.url("/api/desktop/v1/token/revoke"))
                .json(&json!({ "refresh_token": refresh }))
                .send()
                .await;
        }
        self.clear_session();
    }

    fn clear_session(&self) {
        for key in [
            "auth:access_token",
            "auth:refresh_token",
            "auth:expires_at",
            "auth:user",
            "auth:device_id",
            "auth:device_code",
            "host:host_id",
            "auth:host_id",
        ] {
            let _ = self.vault.remove(key);
        }
    }

    pub async fn sync(&self, manager: &Arc<BotManager>) -> AppResult<Option<HeartbeatResult>> {
        if !self.is_authenticated() {
            return Ok(None);
        }
        let host = match manager.host_identity() {
            Some(host) => host,
            None => {
                let name = hostname();
                let identity = self.register_host(&name).await?;
                manager.set_host_identity(identity.clone())?;
                identity
            }
        };
        let stats = host_hardware();
        let bots = manager.host_stats()["bots"].clone();
        let bots = bots.as_array().cloned().unwrap_or_default();
        manager.mark_synced();
        let result = self
            .heartbeat(
                &host.host_id,
                stats.0,
                stats.1,
                stats.2,
                manager.settings().max_concurrent_bots,
                bots,
            )
            .await?;
        for assignment in &result.assignments {
            if let Err(error) = manager.apply_assignment(assignment.clone()).await {
                // Un bot fautif ne doit pas bloquer les autres affectations.
                eprintln!("[zenode-host] affectation {}: {error}", assignment.bot_id);
            }
        }
        for remote_id in &result.removed {
            let _ = manager.detach_remote(remote_id).await;
        }
        Ok(Some(result))
    }
}

/// Nom de machine lisible, sans dépendance externe.
pub fn hostname() -> String {
    #[cfg(unix)]
    {
        let mut buffer = [0u8; 256];
        unsafe {
            if libc::gethostname(buffer.as_mut_ptr() as *mut libc::c_char, buffer.len()) == 0 {
                let end = buffer.iter().position(|b| *b == 0).unwrap_or(buffer.len());
                return String::from_utf8_lossy(&buffer[..end]).to_string();
            }
        }
    }
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Zenode Host".to_string())
}

pub fn host_hardware() -> (f64, f64, f64) {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    system.refresh_cpu_usage();
    let total = system.total_memory() as f64 / 1024.0 / 1024.0;
    let used = system.used_memory() as f64 / 1024.0 / 1024.0;
    let cpu = system.global_cpu_usage() as f64;
    (cpu, used, total)
}

fn normalize_core_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        "https://zenode.fr".to_string()
    } else {
        trimmed.to_string()
    }
}

async fn http_error(response: reqwest::Response) -> crate::error::AppError {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .or_else(|| value.get("message"))
                .and_then(|m| m.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| format!("Le Core a répondu HTTP {}", status.as_u16()));
    err(message)
}

/// Utilisé par la réconciliation pour ne jamais créer un dossier hors du
/// répertoire bots avec un identifiant distant.
pub fn remote_local_id(remote: &str) -> String {
    safe_remote_id(remote)
}
