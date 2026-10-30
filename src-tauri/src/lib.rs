mod cli;
mod commands;
mod documents;
mod error;
mod folder;
#[cfg(test)]
mod fs;
mod registry;
mod search;
mod settings;
mod watcher;

use commands::InitialTargetState;
use parking_lot::Mutex;
use registry::{FolderRegistry, SharedRegistry};
use settings::{data_dir, Settings};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use watcher::{start_folder, SharedWatchers, Watchers};

/// Handle a new CLI target from either single-instance forwarding or macOS
/// file-open events: register folders, update managed state, emit to frontend,
/// and focus the main window.
fn handle_target(app: &tauri::AppHandle, target: cli::InitialTarget) {
    let resolved = match &target {
        cli::InitialTarget::Folder { path } => {
            if let (Some(reg), Some(watchers)) = (
                app.try_state::<SharedRegistry>(),
                app.try_state::<SharedWatchers>(),
            ) {
                if let Ok(folder) = reg.add_folder_lazy(PathBuf::from(path)) {
                    let _ = reg.save(&data_dir());
                    start_folder(
                        app.clone(),
                        Arc::clone(&*reg),
                        Arc::clone(&*watchers),
                        folder.clone(),
                    );
                    cli::InitialTarget::Folder { path: folder.path }
                } else {
                    target.clone()
                }
            } else {
                target.clone()
            }
        }
        other => other.clone(),
    };

    if let Some(state) = app.try_state::<InitialTargetState>() {
        *state.0.lock() = resolved.clone();
    }
    let _ = tauri::Emitter::emit(app, "cli://target", &resolved);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let initial = cli::resolve(&args);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            handle_target(app, cli::resolve(&argv));
        }))
        .setup(move |app| {
            let dir = data_dir();
            let settings = Settings::load(&dir).unwrap_or_default();
            let registry: SharedRegistry = Arc::new(FolderRegistry::from_settings_lazy(settings));
            let watchers: SharedWatchers = Arc::new(Watchers::default());

            let handle = app.handle().clone();
            let initial_resolved = match &initial {
                cli::InitialTarget::Folder { path } => {
                    match registry.add_folder_lazy(PathBuf::from(path)) {
                        Ok(v) => {
                            let _ = registry.save(&dir);
                            cli::InitialTarget::Folder { path: v.path }
                        }
                        Err(_) => cli::InitialTarget::None,
                    }
                }
                other => other.clone(),
            };

            app.manage(InitialTargetState(Mutex::new(initial_resolved)));
            app.manage(Arc::clone(&registry));
            app.manage(Arc::clone(&watchers));
            for folder in registry.folders() {
                start_folder(
                    handle.clone(),
                    Arc::clone(&registry),
                    Arc::clone(&watchers),
                    folder,
                );
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_image,
            commands::list_documents,
            commands::read_document,
            commands::save_document,
            commands::create_document,
            commands::get_initial_target,
            commands::set_initial_target,
            commands::read_file,
            commands::list_folders,
            commands::list_folders_grouped,
            commands::add_folder,
            commands::remove_folder,
            commands::read_folder_tree,
            commands::search_files,
            commands::get_recent_files,
            commands::save_theme,
            commands::save_preferences,
            commands::load_preferences,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Handle macOS file-open events (Finder "Open With", Dock drag-drop,
    // `open /path/to/file.md` when Marky is the default handler).
    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let target = cli::classify(&path);
                    if target != cli::InitialTarget::None {
                        handle_target(app_handle, target);
                        break;
                    }
                }
            }
        }
    });
}
