//! The text of `studio_files.rs`, the set of Studio's built files the feature `embed-studio` compiles into the
//! binary. `build.rs` takes this file with `#[path]`; the crate compiles it only for its tests.

use std::fs;
use std::path::{Path, PathBuf};

/// Walks `dist` (an absolute path) in sorted order and returns the source of a constant `STUDIO_FILES`, a
/// `&[(&str, &[u8])]` of each file's path relative to `dist` (`/`-separated) and `include_bytes!` of its absolute
/// path. Refuses a `dist` without `index.html`, a symlink, anything that is neither a file nor a directory, and a
/// path that is not UTF-8, naming it.
pub fn source(dist: &Path) -> Result<String, String> {
    let mut text = String::from("const STUDIO_FILES: &[(&str, &[u8])] = &[\n");
    for (key, path) in files(dist)? {
        let path = path.to_str().ok_or_else(|| {
            format!(
                "Studio's build holds a path that is not UTF-8: {}",
                path.display()
            )
        })?;
        text.push_str(&format!("    ({key:?}, include_bytes!({path:?})),\n"));
    }
    text.push_str("];\n");
    Ok(text)
}

/// Each file of `dist` as its relative path and its path under `dist`, sorted by the relative path, with the
/// refusals of `source`.
pub fn files(dist: &Path) -> Result<Vec<(String, PathBuf)>, String> {
    let index = dist.join("index.html");
    if !index.is_file() {
        return Err(format!(
            "Studio's build is missing: {} does not exist; run `bun install && bun run build` in studio/ first",
            index.display()
        ));
    }
    let mut files = Vec::new();
    walk(dist, "", &mut files)?;
    files.sort();
    Ok(files)
}

fn walk(dir: &Path, prefix: &str, files: &mut Vec<(String, PathBuf)>) -> Result<(), String> {
    let entries =
        fs::read_dir(dir).map_err(|error| format!("cannot read {}: {error}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("cannot read {}: {error}", dir.display()))?;
        let path = entry.path();
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            return Err(format!(
                "Studio's build holds a name that is not UTF-8: {}",
                path.display()
            ));
        };
        let key = format!("{prefix}{name}");
        let kind = entry
            .file_type()
            .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
        if kind.is_dir() {
            walk(&path, &format!("{key}/"), files)?;
        } else if kind.is_file() {
            files.push((key, path));
        } else {
            return Err(format!(
                "Studio's build holds {}, which is not a plain file or directory (a symlink is refused); rebuild Studio with `bun run build` in studio/",
                path.display()
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dist: &Path, path: &str) {
        let path = dist.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"x").unwrap();
    }

    fn assert_names_missing_index(dist: &Path, error: &str) {
        let index = dist.join("index.html");
        assert!(error.contains(&index.display().to_string()), "{error}");
        assert!(error.contains("bun run build"), "{error}");
    }

    #[test]
    fn source_without_index_is_err_naming_index_and_build() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "assets/a.js");
        let error = source(dir.path()).unwrap_err();
        assert_names_missing_index(dir.path(), &error);
    }

    #[test]
    fn source_of_missing_directory_is_err_naming_index_and_build() {
        let dir = tempfile::tempdir().unwrap();
        let dist = dir.path().join("dist");
        let error = source(&dist).unwrap_err();
        assert_names_missing_index(&dist, &error);
    }

    #[test]
    fn source_of_build_lists_each_file_sorted_with_its_absolute_path() {
        let dir = tempfile::tempdir().unwrap();
        let dist = dir.path();
        for path in ["index.html", "b.svg", "assets/a.js"] {
            write(dist, path);
        }
        let text = source(dist).unwrap();
        let entry = |key: &str| {
            let path = dist.join(key);
            format!(
                "    ({key:?}, include_bytes!({:?})),\n",
                path.to_str().unwrap()
            )
        };
        let expected = format!(
            "const STUDIO_FILES: &[(&str, &[u8])] = &[\n{}{}{}];\n",
            entry("assets/a.js"),
            entry("b.svg"),
            entry("index.html")
        );
        assert_eq!(text, expected);
        assert!(dist.is_absolute());
    }

    #[cfg(unix)]
    #[test]
    fn source_with_symlink_is_err_naming_it() {
        let dir = tempfile::tempdir().unwrap();
        let dist = dir.path();
        write(dist, "index.html");
        write(dist, "outside.txt");
        let link = dist.join("assets/link.js");
        fs::create_dir_all(link.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(dist.join("outside.txt"), &link).unwrap();
        let error = source(dist).unwrap_err();
        assert!(error.contains(&link.display().to_string()), "{error}");
        assert!(error.contains("symlink"), "{error}");
    }
}
