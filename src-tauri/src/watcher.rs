use crate::registry::SharedRegistry;
use notify_debouncer_full::{
    new_debouncer_opt, notify::RecursiveMode, DebounceEventResult, Debouncer, NoCache,
};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub struct WatcherHandle {
    _debouncer: Debouncer<notify::RecommendedWatcher, NoCache>,
}

/// Spin up a debounced watcher per folder. On any change, re-index the folder
/// and emit `folder://changed` with the folder id so the frontend can refresh.
pub fn watch_folder(
    app: AppHandle,
    registry: SharedRegistry,
    folder_id: String,
    root: PathBuf,
) -> anyhow::Result<WatcherHandle> {
    let app_for_cb = app.clone();
    let reg_for_cb = registry.clone();
    let id_for_cb = folder_id.clone();

    let filter_root = root.clone();
    // We rebuild our Markdown index on events, so rename-ID tracking is unnecessary.
    // The default macOS cache recursively walks *all* files and follows symlinks,
    // duplicating our filtered scan and potentially stalling startup.
    let mut debouncer = new_debouncer_opt::<_, notify::RecommendedWatcher, NoCache>(
        Duration::from_millis(200),
        None,
        move |res: DebounceEventResult| {
            if let Ok(events) = res {
                let relevant: Vec<_> = events
                    .iter()
                    .flat_map(|e| e.paths.iter())
                    .filter(|p| relevant_path(&filter_root, p))
                    .collect();
                if relevant.is_empty() {
                    return;
                }
                reg_for_cb.refresh_folder(&id_for_cb);
                let _ = app_for_cb.emit("folder://changed", &id_for_cb);

                let paths: Vec<String> = relevant
                    .into_iter()
                    .filter_map(|p| p.to_str().map(String::from))
                    .collect::<HashSet<_>>()
                    .into_iter()
                    .collect();
                if !paths.is_empty() {
                    let _ = app_for_cb.emit("file://changed", &paths);
                }
            }
        },
        NoCache::new(),
        notify::Config::default(),
    )?;

    debouncer.watch(&root, RecursiveMode::Recursive)?;
    Ok(WatcherHandle {
        _debouncer: debouncer,
    })
}

/// Lifetime holder for active watchers, keyed by folder id.
#[derive(Default)]
pub struct Watchers {
    inner: parking_lot::Mutex<std::collections::HashMap<String, WatcherHandle>>,
}

impl Watchers {
    pub fn insert(&self, id: String, handle: WatcherHandle) {
        self.inner.lock().insert(id, handle);
    }

    pub fn remove(&self, id: &str) {
        self.inner.lock().remove(id);
    }
}

pub type SharedWatchers = Arc<Watchers>;

fn relevant_path(root: &std::path::Path, path: &std::path::Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    if relative
        .components()
        .any(|c| crate::folder::DEFAULT_IGNORES.contains(&c.as_os_str().to_string_lossy().as_ref()))
    {
        return false;
    }
    crate::folder::is_markdown(path) || path.is_dir() || !path.exists()
}

/// A slow filesystem must not block the window or other projects. Retry one
/// cold/unresponsive initial scan after two seconds; never spawn unbounded jobs.
pub fn start_folder(
    app: AppHandle,
    registry: SharedRegistry,
    watchers: SharedWatchers,
    folder: crate::settings::Folder,
) {
    let retry_registry = Arc::clone(&registry);
    let retry_id = folder.id.clone();
    let attempt = move || {
        registry.refresh_folder(&folder.id);
        if let Ok(w) = watch_folder(
            app.clone(),
            Arc::clone(&registry),
            folder.id.clone(),
            PathBuf::from(&folder.path),
        ) {
            watchers.insert(folder.id.clone(), w);
        }
        let _ = app.emit("folder://changed", &folder.id);
    };
    let first = attempt.clone();
    std::thread::spawn(first);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(2));
        if !retry_registry.has_tree(&retry_id) {
            attempt();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ignores_build_noise_but_keeps_agent_docs_and_deletions() {
        let root = std::path::Path::new("/project");
        assert!(!relevant_path(
            root,
            std::path::Path::new("/project/node_modules/a.md")
        ));
        assert!(!relevant_path(
            root,
            std::path::Path::new("/project/.git/index")
        ));
        assert!(relevant_path(
            root,
            std::path::Path::new("/project/.claude/plan.md")
        ));
        assert!(relevant_path(
            root,
            std::path::Path::new("/project/deleted.md")
        ));
    }
}
