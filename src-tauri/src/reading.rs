//! Human-selected project reading list. Never edits or infers validity of a document.
use crate::{
    documents,
    error::{AppError, AppResult},
    registry::FolderRegistry,
};
use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::Path,
    sync::{Mutex, OnceLock},
};
const FILE: &str = "required-reading.json";
static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Mark {
    root: String,
    path: String,
    hash: String,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Store {
    version: u32,
    marks: Vec<Mark>,
}
#[derive(Serialize)]
pub struct ReadingStatus {
    pub folder_id: String,
    pub path: String,
    pub state: String,
}
fn invalid(s: &str) -> AppError {
    AppError::Invalid(s.into())
}
fn load(dir: &Path) -> AppResult<Store> {
    let path = dir.join(FILE);
    if !path.exists() {
        return Ok(Store {
            version: 1,
            marks: Vec::new(),
        });
    }
    if std::fs::metadata(&path)?.len() > 2 * 1024 * 1024 {
        return Err(invalid("必读清单过大，请保留数据后排查"));
    }
    let data = std::fs::read(path)?;
    if data.len() > 2 * 1024 * 1024 {
        return Err(invalid("必读清单过大"));
    }
    let store: Store =
        serde_json::from_slice(&data).map_err(|_| invalid("必读清单损坏，未覆盖原数据"))?;
    if store.version != 1 {
        return Err(invalid("必读清单版本不支持，未覆盖原数据"));
    }
    Ok(store)
}
fn save(dir: &Path, store: &Store) -> AppResult<()> {
    std::fs::create_dir_all(dir)?;
    let mut file = tempfile::NamedTempFile::new_in(dir)?;
    file.write_all(&serde_json::to_vec_pretty(store)?)?;
    file.as_file().sync_all()?;
    file.persist(dir.join(FILE))
        .map_err(|e| AppError::Io(e.error))?;
    Ok(())
}
pub fn list(registry: &FolderRegistry, dir: &Path) -> AppResult<Vec<ReadingStatus>> {
    let _guard = LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| invalid("必读清单暂不可用"))?;
    let store = load(dir)?;
    let mut result = Vec::new();
    for folder in registry.folders() {
        for mark in store.marks.iter().filter(|m| m.root == folder.path) {
            let state = match documents::read(registry, Path::new(&mark.path)) {
                Ok(doc) if doc.hash == mark.hash => "confirmed",
                Ok(_) => "needsReview",
                Err(_) => "unavailable",
            };
            result.push(ReadingStatus {
                folder_id: folder.id.clone(),
                path: mark.path.clone(),
                state: state.into(),
            });
        }
    }
    Ok(result)
}
pub fn update(
    registry: &FolderRegistry,
    dir: &Path,
    folder_id: &str,
    path: &str,
    expected_hash: &str,
    action: &str,
) -> AppResult<()> {
    let _guard = LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| invalid("必读清单暂不可用"))?;
    if !matches!(action, "set" | "confirm" | "remove") {
        return Err(invalid("未知必读操作"));
    }
    let folder = registry
        .folders()
        .into_iter()
        .find(|f| f.id == folder_id)
        .ok_or_else(|| invalid("请先添加项目"))?;
    let doc = documents::read(registry, Path::new(path))?;
    if !Path::new(&doc.path).starts_with(&folder.path) {
        return Err(invalid("文档不属于所选项目"));
    }
    if doc.hash != expected_hash {
        return Err(invalid("文档已变化，请先重新阅读当前内容，再确认必读"));
    }
    let mut store = load(dir)?;
    let existing = store
        .marks
        .iter()
        .position(|m| m.root == folder.path && m.path == doc.path);
    match action {
        "set" if existing.is_some() => return Err(invalid("已是项目必读，请使用确认更新")),
        "confirm" if existing.is_none() => return Err(invalid("必读状态已变化，请刷新")),
        _ => {}
    }
    store
        .marks
        .retain(|m| !(m.root == folder.path && m.path == doc.path));
    if action != "remove" {
        store.marks.push(Mark {
            root: folder.path,
            path: doc.path.clone(),
            hash: doc.hash,
        });
    }
    if documents::read(registry, Path::new(&doc.path))?.hash != expected_hash {
        return Err(invalid("确认期间文档已变化，请重新阅读"));
    }
    save(dir, &store)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manual_choice_survives_restart_and_changes_require_reconfirmation() {
        let root = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let path = root.path().join("plan.md");
        std::fs::write(&path, "# Old\n").unwrap();
        let reg = FolderRegistry::default();
        let folder = reg.add_folder(root.path().into()).unwrap();
        let doc = documents::read(&reg, &path).unwrap();
        assert!(list(&reg, data.path()).unwrap().is_empty());
        update(&reg, data.path(), &folder.id, &doc.path, &doc.hash, "set").unwrap();
        assert_eq!(list(&reg, data.path()).unwrap()[0].state, "confirmed");
        let original = std::fs::read(data.path().join(FILE)).unwrap();
        std::fs::write(&path, "# New\n").unwrap();
        assert_eq!(list(&reg, data.path()).unwrap()[0].state, "needsReview");
        assert!(update(
            &reg,
            data.path(),
            &folder.id,
            &doc.path,
            &doc.hash,
            "confirm"
        )
        .is_err());
        assert_eq!(std::fs::read(data.path().join(FILE)).unwrap(), original);
        let current = documents::read(&reg, &path).unwrap();
        update(
            &reg,
            data.path(),
            &folder.id,
            &doc.path,
            &current.hash,
            "confirm",
        )
        .unwrap();
        assert_eq!(list(&reg, data.path()).unwrap()[0].state, "confirmed");
        std::fs::remove_file(&path).unwrap();
        assert_eq!(list(&reg, data.path()).unwrap()[0].state, "unavailable");
        std::fs::write(&path, "# New\n").unwrap();
        reg.remove_folder(&folder.id);
        assert!(list(&reg, data.path()).unwrap().is_empty());
        let again = reg.add_folder(root.path().into()).unwrap();
        assert_eq!(list(&reg, data.path()).unwrap()[0].state, "confirmed");
        update(
            &reg,
            data.path(),
            &again.id,
            &doc.path,
            &current.hash,
            "remove",
        )
        .unwrap();
        assert!(list(&reg, data.path()).unwrap().is_empty());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "# New\n");
    }
    #[test]
    fn boundaries_corruption_and_missing_files_do_not_discard_marks() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let reg = FolderRegistry::default();
        let af = reg.add_folder(a.path().into()).unwrap();
        let bf = reg.add_folder(b.path().into()).unwrap();
        let path = b.path().join("x.md");
        std::fs::write(&path, "x").unwrap();
        let doc = documents::read(&reg, &path).unwrap();
        assert!(update(&reg, data.path(), &af.id, &doc.path, &doc.hash, "set").is_err());
        std::fs::write(data.path().join(FILE), "broken").unwrap();
        assert!(list(&reg, data.path()).is_err());
        assert!(update(&reg, data.path(), &af.id, &doc.path, &doc.hash, "set").is_err());
        assert!(update(&reg, data.path(), &bf.id, &doc.path, &doc.hash, "set").is_err());
        assert_eq!(
            std::fs::read_to_string(data.path().join(FILE)).unwrap(),
            "broken"
        );
    }
}
