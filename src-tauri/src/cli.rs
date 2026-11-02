use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum InitialTarget {
    File { path: String },
    Folder { path: String },
    None,
}

/// Resolve a CLI argv into an InitialTarget.
///
/// - `marky FILE.md` → File
/// - `marky DIR/`     → Folder
/// - `marky` (none)   → None
/// - missing path     → None (we don't error; user gets empty state)
pub fn resolve(args: &[String]) -> InitialTarget {
    let raw = match args.iter().skip(1).find(|a| !a.starts_with("--")) {
        Some(a) => a,
        None => return InitialTarget::None,
    };

    let path = PathBuf::from(raw);
    let abs = match std::fs::canonicalize(&path) {
        Ok(p) => p,
        Err(_) => return InitialTarget::None,
    };

    classify(&abs)
}

pub(crate) fn classify(path: &Path) -> InitialTarget {
    let s = match path.to_str() {
        Some(s) => s.to_string(),
        None => return InitialTarget::None,
    };
    if path.is_dir() {
        InitialTarget::Folder { path: s }
    } else if path.is_file() {
        InitialTarget::File { path: s }
    } else {
        InitialTarget::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn resolves_no_args_to_none() {
        let args = vec!["marky".to_string()];
        assert_eq!(resolve(&args), InitialTarget::None);
    }

    #[test]
    fn resolves_missing_path_to_none() {
        let args = vec!["marky".into(), "/nonexistent/path/xyz123".into()];
        assert_eq!(resolve(&args), InitialTarget::None);
    }

    #[test]
    fn resolves_file_to_file() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("a.md");
        fs::write(&p, "# hi").unwrap();
        let args = vec!["marky".into(), p.to_string_lossy().into_owned()];
        match resolve(&args) {
            InitialTarget::File { path } => assert!(path.ends_with("a.md")),
            other => panic!("expected file, got {:?}", other),
        }
    }

    #[test]
    fn resolves_dir_to_folder() {
        let dir = tempdir().unwrap();
        let args = vec!["marky".into(), dir.path().to_string_lossy().into_owned()];
        matches!(resolve(&args), InitialTarget::Folder { .. });
    }

    #[test]
    fn skips_flag_args() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("b.md");
        fs::write(&p, "x").unwrap();
        let args = vec![
            "marky".into(),
            "--debug".into(),
            p.to_string_lossy().into_owned(),
        ];
        matches!(resolve(&args), InitialTarget::File { .. });
    }
}

/// A file target registers its real parent in Rust, including native Windows prefixes.
pub fn project_folder(target: &InitialTarget) -> Option<PathBuf> {
    match target {
        InitialTarget::Folder { path } => Some(PathBuf::from(path)),
        InitialTarget::File { path } => Path::new(path).parent().map(Path::to_path_buf),
        InitialTarget::None => None,
    }
}
#[cfg(test)]
mod project_tests {
    use super::*;
    #[test]
    fn file_target_uses_native_parent() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("document.md");
        assert_eq!(
            project_folder(&InitialTarget::File {
                path: file.to_string_lossy().into_owned()
            }),
            Some(dir.path().to_owned())
        );
        assert_eq!(project_folder(&InitialTarget::None), None);
    }
}
