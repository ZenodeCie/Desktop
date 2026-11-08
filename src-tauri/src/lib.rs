pub mod bot;
pub mod commands;
pub mod core;
pub mod crypto;
pub mod error;
pub mod limits;
pub mod models;
pub mod paths;
pub mod runtime;
pub mod template;
pub mod vault;

use std::sync::Arc;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

use crate::bot::BotManager;
use crate::commands::AppState;
use crate::core::CoreClient;
use crate::paths::AppPaths;
use crate::runtime::RuntimeManager;
use crate::vault::Vault;

/// Point d'entrée partagé par `main.rs` (desktop) et les tests d'intégration.
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .setup(|app| {
            let handle = app.handle().clone();
            let paths = AppPaths::resolve(&handle)?;
            let vault = Arc::new(Vault::open(&paths.secrets_file)?);
            let runtime = Arc::new(RuntimeManager::new(paths.clone()));
            let manager = Arc::new(BotManager::new(
                handle.clone(),
                paths,
                vault.clone(),
                runtime.clone(),
            )?);
            let core = Arc::new(CoreClient::new(vault, manager.settings().core_url));

            app.manage(AppState {
                manager: manager.clone(),
                core,
                runtime,
            });

            build_tray(&handle)?;
            spawn_monitor(handle.clone());
            spawn_sync(handle.clone());
            spawn_backup(handle.clone());

            // Démarre les bots marqués `auto_start` en arrière-plan : l'UI ne
            // doit pas attendre les installations de dépendances.
            tauri::async_runtime::spawn(async move {
                manager.start_autostart().await;
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let close_to_tray = window
                    .app_handle()
                    .state::<AppState>()
                    .manager
                    .settings()
                    .close_to_tray;
                if close_to_tray {
                    // Fermer la fenêtre ne quitte pas : les bots continuent de
                    // tourner, comme le veut un hôte de bots.
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::get_settings,
            commands::save_settings,
            commands::list_bots,
            commands::get_bot,
            commands::update_bot,
            commands::delete_bot,
            commands::set_bot_token,
            commands::clear_bot_token,
            commands::start_bot,
            commands::stop_bot,
            commands::restart_bot,
            commands::get_bot_logs,
            commands::list_bot_files,
            commands::read_bot_file,
            commands::write_bot_file,
            commands::open_bot_folder,
            commands::open_in_editor,
            commands::editor_availability,
            commands::runtime_status,
            commands::install_runtime,
            commands::auth_start_pairing,
            commands::auth_poll_pairing,
            commands::auth_logout,
            commands::auth_state,
            commands::sync_now,
            commands::list_clusters,
            commands::cluster_detail,
            commands::create_cluster,
            commands::join_cluster,
            commands::leave_cluster,
            commands::create_cluster_invite,
            commands::delete_cluster,
            commands::deploy_bot,
            commands::remove_cluster_bot,
            commands::assign_cluster_bot,
            commands::report_cluster_bot,
            commands::block_cluster_bot,
            commands::list_catalog,
            commands::install_catalog_bot,
            commands::check_updates,
            commands::open_url,
            commands::open_logs_folder,
            commands::open_storage_access_settings,
            commands::local_host_stats,
            commands::hide_window,
            commands::show_window,
            commands::quit_app,
        ]);

    let app = match builder.build(tauri::generate_context!()) {
        Ok(app) => app,
        Err(error) => {
            eprintln!("[zenode-host] démarrage impossible : {error}");
            std::process::exit(1);
        }
    };

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            // Les bots sont des processus enfants : on les arrête proprement
            // sinon ils survivraient à la fermeture de l'application.
            app_handle.state::<AppState>().manager.shutdown_all();
        }
    });
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Ouvrir Zenode Host", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::with_id("zenode-host")
        .tooltip("Zenode Host")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Boucle de métriques : CPU/RAM par bot toutes les 3 secondes, émises vers
/// l'interface via les événements `bot://stats` (voir `BotManager::apply_stats`).
fn spawn_monitor(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut system = sysinfo::System::new();
        loop {
            tokio::time::sleep(Duration::from_secs(3)).await;
            let state = app.state::<AppState>();
            let settings = state.manager.settings();
            if settings.minimize_to_tray {
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_minimized().unwrap_or(false) {
                        let _ = window.hide();
                    }
                }
            }
            let running = state.manager.running_snapshot();
            if running.is_empty() {
                continue;
            }
            system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
            for (bot_id, pid) in running {
                if let Some(process) = system.process(sysinfo::Pid::from_u32(pid)) {
                    let memory_mb = process.memory() as f64 / 1024.0 / 1024.0;
                    state
                        .manager
                        .apply_stats(&bot_id, process.cpu_usage(), memory_mb);
                }
            }
        }
    });
}

/// Boucle de backup automatique : toutes les 48 h, déclenche une sauvegarde
/// des données des clusters communautaires publics. Une nouvelle backup écrase
/// la précédente. Les clusters privés ou non communautaires ne sont pas
/// sauvegardés.
fn spawn_backup(app: AppHandle) {
    const BACKUP_INTERVAL_SECS: u64 = 48 * 60 * 60; // 48 heures

    tauri::async_runtime::spawn(async move {
        // Attente initiale de 60 s pour ne pas surcharger le boot.
        tokio::time::sleep(Duration::from_secs(60)).await;
        loop {
            let (core, manager) = {
                let state = app.state::<AppState>();
                (state.core.clone(), state.manager.clone())
            };
            if let Err(error) = core.backup_community_clusters(&manager).await {
                eprintln!("[zenode-host] backup clusters communautaires : {error}");
            }
            tokio::time::sleep(Duration::from_secs(BACKUP_INTERVAL_SECS)).await;
        }
    });
}

/// Boucle de synchronisation Core : heartbeat, affectations de cluster et
/// reprise après panne. L'intervalle est relu à chaque tour pour refléter les
/// réglages sans redémarrer l'application.
fn spawn_sync(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let interval = {
                let state = app.state::<AppState>();
                state.manager.settings().heartbeat_secs.max(10)
            };
            tokio::time::sleep(Duration::from_secs(interval)).await;
            let (core, manager) = {
                let state = app.state::<AppState>();
                (state.core.clone(), state.manager.clone())
            };
            if let Err(error) = core.sync(&manager).await {
                // Le Core peut être momentanément indisponible : on réessaie
                // au prochain tour plutôt que de remonter une erreur à l'UI.
                eprintln!("[zenode-host] synchronisation : {error}");
            }
        }
    });
}
