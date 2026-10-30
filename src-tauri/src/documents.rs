//! Project-scoped document IO. User documents remain ordinary files.
use crate::error::{AppError, AppResult};
use crate::folder::{is_markdown, IndexedFile};
use crate::registry::FolderRegistry;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

const MAX_BYTES: usize = 5 * 1024 * 1024;

#[derive(Serialize)]
pub struct Document {
    pub path: String,
    pub content: String,
    pub hash: String,
}

fn invalid(message: &str) -> AppError {
    AppError::Invalid(message.into())
}

fn scoped_path(registry: &FolderRegistry, path: &Path) -> AppResult<PathBuf> {
    if !is_markdown(path) {
        return Err(invalid("只支持 Markdown 文档"));
    }
    let canonical = std::fs::canonicalize(path)?;
    if !canonical.is_file() {
        return Err(invalid("请选择文件"));
    }
    if !registry
        .folders()
        .iter()
        .any(|f| canonical.starts_with(&f.path))
    {
        return Err(invalid("文档不在已添加的项目中"));
    }
    // Refuse symlink writes rather than replacing the link or escaping a root.
    if std::fs::symlink_metadata(path)?.file_type().is_symlink() {
        return Err(invalid("暂不编辑符号链接文档，请打开原文件所在项目"));
    }
    Ok(canonical)
}

fn snapshot(path: &Path) -> AppResult<Document> {
    if std::fs::metadata(path)?.len() > MAX_BYTES as u64 {
        return Err(invalid("文档超过 5 MB，请用其他编辑器打开"));
    }
    let bytes = std::fs::read(path)?;
    if bytes.len() > MAX_BYTES {
        return Err(invalid("文档超过 5 MB"));
    }
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let content = String::from_utf8(bytes).map_err(|_| invalid("文档不是 UTF-8 文本"))?;
    Ok(Document {
        path: path.to_string_lossy().into_owned(),
        content,
        hash,
    })
}

pub fn read(registry: &FolderRegistry, path: &Path) -> AppResult<Document> {
    snapshot(&scoped_path(registry, path)?)
}

pub fn list(registry: &FolderRegistry) -> Vec<IndexedFile> {
    let mut files = registry.index_snapshot();
    // Overlapping project roots must not show the same document twice.
    let roots: std::collections::HashMap<_, _> = registry
        .folders()
        .into_iter()
        .map(|f| (f.id, f.path.len()))
        .collect();
    files.sort_by(|a, b| {
        roots
            .get(&b.folder_id)
            .cmp(&roots.get(&a.folder_id))
            .then(a.absolute_path.cmp(&b.absolute_path))
    });
    let mut seen = std::collections::HashSet::new();
    files.retain(|f| seen.insert(f.absolute_path.clone()));
    files.sort_by(|a, b| {
        b.modified_ms
            .cmp(&a.modified_ms)
            .then(a.absolute_path.cmp(&b.absolute_path))
    });
    files
}

pub fn save(
    registry: &FolderRegistry,
    path: &Path,
    content: &str,
    expected_hash: &str,
) -> AppResult<Document> {
    if content.len() > MAX_BYTES {
        return Err(invalid("文档超过 5 MB"));
    }
    let target = scoped_path(registry, path)?;
    if snapshot(&target)?.hash != expected_hash {
        return Err(invalid(
            "文件已被外部修改；你的草稿已保留，请重新读取后再保存",
        ));
    }
    let mut temp =
        tempfile::NamedTempFile::new_in(target.parent().ok_or_else(|| invalid("无父目录"))?)?;
    temp.write_all(content.as_bytes())?;
    temp.as_file()
        .set_permissions(std::fs::metadata(&target)?.permissions())?;
    temp.as_file().sync_all()?;
    // Re-check after preparing the temporary file. This detects ordinary Agent
    // edits, but isn't a cross-process filesystem transaction with other editors.
    if scoped_path(registry, path)? != target || snapshot(&target)?.hash != expected_hash {
        return Err(invalid("文件已被外部修改；你的草稿已保留"));
    }
    temp.persist(&target).map_err(|e| AppError::Io(e.error))?;
    snapshot(&target)
}

pub fn create(registry: &FolderRegistry, folder_id: &str, name: &str) -> AppResult<Document> {
    let mut components = Path::new(name).components();
    if name.trim() != name
        || name.starts_with('.')
        || !matches!(components.next(), Some(Component::Normal(_)))
        || components.next().is_some()
        || name.contains(['/', '\\', ':'])
        || !is_markdown(Path::new(name))
    {
        return Err(invalid(
            "请输入文件名，例如 我的笔记.md；不能包含路径或以点开头",
        ));
    }
    let folder = registry
        .folders()
        .into_iter()
        .find(|f| f.id == folder_id)
        .ok_or_else(|| invalid("请先选择项目"))?;
    let root = std::fs::canonicalize(&folder.path)?;
    if root != Path::new(&folder.path) {
        return Err(invalid("项目路径已变化，请重新添加"));
    }
    let path = root.join(name);
    let title = Path::new(name)
        .file_stem()
        .and_then(|x| x.to_str())
        .unwrap_or("新文档");
    let mut temp = tempfile::NamedTempFile::new_in(&root)?;
    temp.write_all(format!("# {title}\n\n").as_bytes())?;
    temp.as_file().sync_all()?;
    temp.persist_noclobber(&path).map_err(|e| {
        if e.error.kind() == std::io::ErrorKind::AlreadyExists {
            invalid("同名文件已存在，请换一个名字")
        } else {
            AppError::Io(e.error)
        }
    })?;
    registry.refresh_folder(folder_id);
    snapshot(&path)
}

pub fn read_image(registry: &FolderRegistry, path: &Path) -> AppResult<String> {
    use base64::Engine;
    let target = std::fs::canonicalize(path)?;
    if !registry
        .folders()
        .iter()
        .any(|f| target.starts_with(&f.path))
    {
        return Err(invalid("图片不在已添加的项目中"));
    }
    let ext = target
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        _ => return Err(invalid("暂不支持此图片格式")),
    };
    if std::fs::metadata(&target)?.len() > MAX_BYTES as u64 {
        return Err(invalid("图片超过 5 MB"));
    }
    let bytes = std::fs::read(target)?;
    if bytes.len() > MAX_BYTES {
        return Err(invalid("图片超过 5 MB"));
    }
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::Settings;
    fn setup() -> (tempfile::TempDir, FolderRegistry, String) {
        let dir = tempfile::tempdir().unwrap();
        let registry = FolderRegistry::from_settings(Settings::default());
        let f = registry.add_folder(dir.path().to_owned()).unwrap();
        (dir, registry, f.id)
    }
    #[test]
    fn local_images_are_scoped_and_active_formats_are_rejected() {
        let (dir, r, _) = setup();
        let image = dir.path().join("pixel.png");
        std::fs::write(&image, b"image fixture").unwrap();
        assert!(read_image(&r, &image)
            .unwrap()
            .starts_with("data:image/png;base64,"));
        let outside = tempfile::tempdir().unwrap();
        let other = outside.path().join("outside.png");
        std::fs::write(&other, b"private").unwrap();
        assert!(read_image(&r, &other).is_err());
        let svg = dir.path().join("script.svg");
        std::fs::write(&svg, b"<svg/>").unwrap();
        assert!(read_image(&r, &svg).is_err());
    }

    #[test]
    fn creates_without_overwrite_and_rejects_traversal() {
        let (_dir, r, id) = setup();
        let doc = create(&r, &id, "笔记.md").unwrap();
        assert_eq!(doc.content, "# 笔记\n\n");
        assert!(create(&r, &id, "笔记.md").is_err());
        for bad in [
            "../escape.md",
            "sub/file.md",
            ".secret.md",
            "file.txt",
            "/file.md",
        ] {
            assert!(create(&r, &id, bad).is_err());
        }
    }
    #[test]
    fn save_detects_external_change_and_keeps_external_bytes() {
        let (_dir, r, id) = setup();
        let doc = create(&r, &id, "a.md").unwrap();
        std::fs::write(&doc.path, "Agent edit").unwrap();
        assert!(save(&r, Path::new(&doc.path), "my draft", &doc.hash).is_err());
        assert_eq!(std::fs::read_to_string(&doc.path).unwrap(), "Agent edit");
    }
    #[test]
    fn saves_same_version_and_refuses_deleted_file() {
        let (_dir, r, id) = setup();
        let doc = create(&r, &id, "a.md").unwrap();
        let next = save(&r, Path::new(&doc.path), "# Updated\n", &doc.hash).unwrap();
        assert_ne!(doc.hash, next.hash);
        std::fs::remove_file(&doc.path).unwrap();
        assert!(save(&r, Path::new(&doc.path), "draft", &next.hash).is_err());
        assert!(!Path::new(&doc.path).exists());
    }
    #[test]
    fn rejects_outside_project_and_symlink_escape() {
        let (dir, r, _) = setup();
        let outside = tempfile::tempdir().unwrap();
        let path = outside.path().join("secret.md");
        std::fs::write(&path, "private").unwrap();
        assert!(read(&r, &path).is_err());
        #[cfg(unix)]
        {
            let link = dir.path().join("link.md");
            std::os::unix::fs::symlink(&path, &link).unwrap();
            assert!(read(&r, &link).is_err());
        }
    }
    #[test]
    fn multiple_projects_collect_new_files_and_deduplicate_overlaps() {
        let (dir, r, id) = setup();
        create(&r, &id, "a.md").unwrap();
        let second = tempfile::tempdir().unwrap();
        std::fs::write(second.path().join("b.md"), "b").unwrap();
        r.add_folder(second.path().to_owned()).unwrap();
        std::fs::create_dir(dir.path().join("docs")).unwrap();
        std::fs::write(dir.path().join("docs/c.md"), "c").unwrap();
        r.add_folder(dir.path().join("docs")).unwrap();
        r.refresh_folder(&id);
        let files = list(&r);
        assert_eq!(files.len(), 3);
        assert!(files
            .windows(2)
            .all(|w| w[0].modified_ms >= w[1].modified_ms));
    }
}
