use std::sync::Arc;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;

use crate::bot::{BotManager, CreateBotInput};
use crate::core::{self, CoreClient};
use crate::error::{err, AppResult};
use crate::models::*;
use crate::runtime::{RuntimeManager, BUN_VERSION};

pub struct AppState {
    pub manager: Arc<BotManager>,
    pub core: Arc<CoreClient>,
    pub runtime: Arc<RuntimeManager>,
}

#[tauri::command]
pub fn app_info(state: State<'_, AppState>, app: AppHandle) -> AppResult<Value> {
    let settings = state.manager.settings();
    Ok(json!({
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "runtime": state.runtime.status(),
        "auth": state.core.auth_state(),
        "settings": settings,
        "core_url": state.core.core_url(),
        "host": state.manager.host_identity(),
        "last_sync": state.manager.last_sync(),
        "editors": state.manager.editors(),
        "autostart": app.autolaunch().is_enabled().unwrap_or(false),
        "paths": {
            "data": state.manager.paths().data_dir.to_string_lossy(),
            "bots": state.manager.paths().bots_dir.to_string_lossy(),
            "logs": state.manager.paths().logs_dir.to_string_lossy(),
        }
    }))
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.manager.settings()
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, AppState>,
    app: AppHandle,
    settings: Settings,
) -> AppResult<Settings> {
    state.core.set_core_url(&settings.core_url)?;
    let saved = state.manager.update_settings(settings)?;
    let autolaunch = app.autolaunch();
    if saved.launch_at_login {
        let _ = autolaunch.enable();
    } else {
        let _ = autolaunch.disable();
    }
    Ok(saved)
}

#[tauri::command]
pub fn list_bots(state: State<'_, AppState>) -> Vec<BotSummary> {
    state.manager.list()
}

#[tauri::command]
pub fn get_bot(state: State<'_, AppState>, id: String) -> AppResult<BotSummary> {
    state.manager.get(&id)
}

#[tauri::command]
pub fn create_bot(state: State<'_, AppState>, input: CreateBotInput) -> AppResult<BotSummary> {
    state.manager.create(input)
}

#[tauri::command]
pub fn update_bot(state: State<'_, AppState>, id: String, patch: Value) -> AppResult<BotSummary> {
    state.manager.update_bot(&id, patch)
}

#[tauri::command]
pub async fn delete_bot(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.manager.delete(&id)
}

#[tauri::command]
pub fn set_bot_token(state: State<'_, AppState>, id: String, token: String) -> AppResult<()> {
    state.manager.set_token(&id, &token)
}

#[tauri::command]
pub fn clear_bot_token(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.manager.clear_token(&id)
}

#[tauri::command]
pub async fn start_bot(state: State<'_, AppState>, id: String) -> AppResult<BotSummary> {
    state.manager.start(&id).await
}

#[tauri::command]
pub async fn stop_bot(state: State<'_, AppState>, id: String) -> AppResult<BotSummary> {
    state.manager.stop(&id).await
}

#[tauri::command]
pub async fn restart_bot(state: State<'_, AppState>, id: String) -> AppResult<BotSummary> {
    state.manager.restart(&id).await
}

#[tauri::command]
pub fn get_bot_logs(state: State<'_, AppState>, id: String, limit: Option<usize>) -> Vec<LogLine> {
    state.manager.logs(&id, limit.unwrap_or(500))
}

#[tauri::command]
pub fn list_bot_files(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Vec<crate::bot::FileEntry>> {
    state.manager.files(&id)
}

#[tauri::command]
pub fn read_bot_file(state: State<'_, AppState>, id: String, path: String) -> AppResult<String> {
    state.manager.read_file(&id, &path)
}

#[tauri::command]
pub fn write_bot_file(
    state: State<'_, AppState>,
    id: String,
    path: String,
    contents: String,
) -> AppResult<()> {
    state.manager.write_file(&id, &path, &contents)
}

#[tauri::command]
pub fn open_bot_folder(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.manager.open_folder(&id)
}

#[tauri::command]
pub fn open_in_editor(state: State<'_, AppState>, id: String, editor: String) -> AppResult<()> {
    state.manager.open_editor(&id, &editor)
}

#[tauri::command]
pub fn editor_availability(state: State<'_, AppState>) -> crate::bot::EditorAvailability {
    state.manager.editors()
}

#[tauri::command]
pub fn runtime_status(state: State<'_, AppState>) -> RuntimeStatus {
    state.runtime.status()
}

#[tauri::command]
pub async fn install_runtime(
    state: State<'_, AppState>,
    app: AppHandle,
) -> AppResult<RuntimeStatus> {
    let status = state.runtime.install(&app).await?;
    let manager = state.manager.clone();
    tokio::spawn(async move {
        manager.start_autostart().await;
    });
    Ok(status)
}

#[tauri::command]
pub async fn auth_start_pairing(
    state: State<'_, AppState>,
    device_name: Option<String>,
) -> AppResult<PairingInfo> {
    let name = device_name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(core::hostname);
    state.core.start_pairing(name).await
}

#[tauri::command]
pub async fn auth_poll_pairing(state: State<'_, AppState>) -> AppResult<Value> {
    let response = state.core.poll_pairing().await?;
    if response.status == "approved" {
        let name = core::hostname();
        match state.core.register_host(&name).await {
            Ok(host) => {
                state.manager.set_host_identity(host)?;
            }
            Err(error) => {
                return Ok(json!({
                    "status": "approved",
                    "warning": format!("Compte lié, mais enregistrement de la machine impossible : {error}"),
                }));
            }
        }
    }
    Ok(json!({
        "status": response.status,
        "message": response.message,
        "user": response.user,
    }))
}

#[tauri::command]
pub async fn auth_logout(state: State<'_, AppState>) -> AppResult<()> {
    state.core.revoke().await;
    Ok(())
}

#[tauri::command]
pub fn auth_state(state: State<'_, AppState>) -> AuthState {
    state.core.auth_state()
}

#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>) -> AppResult<Value> {
    let result = state.core.sync(&state.manager).await?;
    Ok(match result {
        Some(result) => json!({
            "ok": true,
            "host_status": result.host_status,
            "assignments": result.assignments.len(),
            "removed": result.removed.len(),
        }),
        None => json!({ "ok": false, "reason": "not_authenticated" }),
    })
}

#[tauri::command]
pub async fn list_clusters(state: State<'_, AppState>) -> AppResult<Vec<ClusterSummary>> {
    state.core.list_clusters().await
}

#[tauri::command]
pub async fn cluster_detail(
    state: State<'_, AppState>,
    cluster_id: String,
) -> AppResult<ClusterDetail> {
    state.core.cluster_detail(&cluster_id).await
}

#[tauri::command]
pub async fn create_cluster(
    state: State<'_, AppState>,
    name: String,
    visibility: String,
    description: Option<String>,
) -> AppResult<Value> {
    if !matches!(visibility.as_str(), "private" | "public") {
        return Err(err("Visibilité invalide."));
    }
    state
        .core
        .create_cluster(&name, &visibility, description.as_deref().unwrap_or(""))
        .await
}

#[tauri::command]
pub async fn join_cluster(state: State<'_, AppState>, code: String) -> AppResult<Value> {
    let code = code.trim();
    if code.len() < 4 || code.len() > 128 {
        return Err(err("Code d'invitation invalide."));
    }
    state.core.join_cluster(code).await
}

#[tauri::command]
pub async fn leave_cluster(state: State<'_, AppState>, cluster_id: String) -> AppResult<Value> {
    state.core.leave_cluster(&cluster_id).await
}

#[tauri::command]
pub async fn create_cluster_invite(
    state: State<'_, AppState>,
    cluster_id: String,
) -> AppResult<Value> {
    state.core.create_invite(&cluster_id).await
}

#[tauri::command]
pub async fn delete_cluster(state: State<'_, AppState>, cluster_id: String) -> AppResult<Value> {
    state.core.delete_cluster(&cluster_id).await
}

#[tauri::command]
pub async fn deploy_bot(
    state: State<'_, AppState>,
    cluster_id: String,
    bot_id: String,
    host_id: Option<String>,
) -> AppResult<Value> {
    let record = state.manager.get(&bot_id)?;
    let token = state
        .manager
        .vault()
        .get(&format!("bot:{bot_id}:token"))
        .ok_or_else(|| err("Ce bot n'a pas de jeton : configurez-le avant de le déployer."))?;
    let payload = json!({
        "bot_id": record.record.remote_bot_id,
        "name": record.record.name,
        "description": record.record.description,
        "token": token,
        "entry": record.record.entry,
        "host_id": host_id,
        "source_url": null,
        "local_id": record.record.id,
    });
    state.core.deploy_bot(&cluster_id, payload).await
}

#[tauri::command]
pub async fn remove_cluster_bot(
    state: State<'_, AppState>,
    cluster_id: String,
    bot_id: String,
) -> AppResult<Value> {
    state.core.remove_cluster_bot(&cluster_id, &bot_id).await
}

#[tauri::command]
pub async fn assign_cluster_bot(
    state: State<'_, AppState>,
    cluster_id: String,
    bot_id: String,
    host_id: Option<String>,
) -> AppResult<Value> {
    state
        .core
        .assign_bot(&cluster_id, &bot_id, host_id.as_deref())
        .await
}

#[tauri::command]
pub async fn report_cluster_bot(
    state: State<'_, AppState>,
    cluster_id: String,
    bot_id: String,
    reason: String,
) -> AppResult<Value> {
    if reason.trim().len() < 5 {
        return Err(err("Décrivez le problème en quelques mots."));
    }
    state
        .core
        .report_bot(&cluster_id, &bot_id, reason.trim())
        .await
}

#[tauri::command]
pub async fn block_cluster_bot(
    state: State<'_, AppState>,
    cluster_id: String,
    bot_id: String,
    reason: String,
) -> AppResult<Value> {
    state
        .core
        .block_bot(&cluster_id, &bot_id, reason.trim())
        .await
}

#[tauri::command]
pub async fn list_catalog(state: State<'_, AppState>) -> AppResult<Vec<CatalogBot>> {
    state.core.catalog().await
}

#[derive(Deserialize)]
pub struct CatalogInstallInput {
    pub slug: String,
    pub name: Option<String>,
    pub token: String,
}

#[tauri::command]
pub async fn install_catalog_bot(
    state: State<'_, AppState>,
    input: CatalogInstallInput,
) -> AppResult<BotSummary> {
    let catalog = state.core.catalog().await?;
    let bot = catalog
        .into_iter()
        .find(|item| item.slug == input.slug)
        .ok_or_else(|| err("Bot introuvable dans le catalogue."))?;
    let summary = state.manager.create(CreateBotInput {
        name: input.name.unwrap_or_else(|| bot.name.clone()),
        description: bot.description.clone(),
        token: Some(input.token),
        auto_start: false,
    })?;
    if let Some(url) = bot.source_url.as_deref() {
        let _ = state.manager.install_source(&summary.record.id, url).await;
    }
    state.manager.get(&summary.record.id)
}

#[tauri::command]
pub async fn check_updates(state: State<'_, AppState>) -> AppResult<Option<UpdateInfo>> {
    state
        .core
        .check_update(std::env::consts::OS, std::env::consts::ARCH)
        .await
}

#[tauri::command]
pub fn open_url(url: String) -> AppResult<()> {
    let parsed = url::Url::parse(&url).map_err(|_| err("URL invalide."))?;
    if !matches!(parsed.scheme(), "https" | "http") {
        return Err(err("Seules les URL HTTP(S) sont autorisées."));
    }
    open_external(parsed.as_str())
}

#[tauri::command]
pub fn open_logs_folder(state: State<'_, AppState>) -> AppResult<()> {
    open_external(&state.manager.paths().logs_dir.to_string_lossy())
}

/// macOS ne permet pas à une app de s'ajouter elle-même aux accès complets au
/// disque : l'utilisateur confirme toujours l'autorisation dans Réglages.
#[tauri::command]
pub fn open_storage_access_settings() -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        return open_external(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
        );
    }

    #[cfg(not(target_os = "macos"))]
    Ok(())
}

#[tauri::command]
pub fn local_host_stats(state: State<'_, AppState>) -> Value {
    let (cpu, used, total) = core::host_hardware();
    json!({
        "cpu_percent": cpu,
        "memory_used_mb": used,
        "memory_total_mb": total,
        "bots": state.manager.list(),
        "host": state.manager.host_identity(),
        "runtime_version": BUN_VERSION,
    })
}

#[tauri::command]
pub fn hide_window(app: AppHandle) -> AppResult<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().ok();
    }
    Ok(())
}

#[tauri::command]
pub fn show_window(app: AppHandle) -> AppResult<()> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

fn open_external(target: &str) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(target).spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32")
        .arg("url.dll,FileProtocolHandler")
        .arg(target)
        .spawn();
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let result = std::process::Command::new("xdg-open").arg(target).spawn();
    result
        .map(|_| ())
        .map_err(|e| err(format!("Impossible d'ouvrir le lien : {e}")))
}
