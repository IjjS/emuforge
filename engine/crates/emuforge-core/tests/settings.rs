#![cfg(test)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use emuforge_core::{
    ChangeError, Endpoint, Replaced, SETTINGS_CAP, SETTINGS_FILE, Settings, SettingsError, Store,
    Target, TargetError, TargetName,
};
use serde_json::{Value, json};
use tempfile::TempDir;

/// A marker that only a test's file holds, to show no message carries the file's text.
const MARKER: &str = "zq-marker-zq";

fn name(text: &str) -> TargetName {
    TargetName::parse(text).unwrap()
}

fn target(text: &str, at: &str) -> Target {
    Target::new(name(text), Endpoint::parse(at).unwrap())
}

fn seed() -> Settings {
    Settings::seed(
        name("local"),
        Endpoint::parse("https://127.0.0.1:9297").unwrap(),
    )
}

/// A temp folder and a store on `<it>/settings`, a folder that does not exist yet.
fn store() -> (TempDir, Store) {
    let root = tempfile::tempdir().unwrap();
    let store = Store::new(root.path().join("settings"), seed());
    (root, store)
}

fn write_file(store: &Store, bytes: &[u8]) {
    fs::create_dir_all(store.file().parent().unwrap()).unwrap();
    fs::write(store.file(), bytes).unwrap();
}

fn file_json(targets: Value, active: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({"version": 1, "active": active, "targets": targets})).unwrap()
}

fn entry(text: &str, port: u16) -> Value {
    json!({"name": text, "endpoint": format!("https://127.0.0.1:{port}")})
}

fn entries(count: usize) -> Value {
    Value::Array(
        (0..count)
            .map(|index| entry(&format!("t{index}"), 9297))
            .collect(),
    )
}

fn folder_entries(store: &Store) -> Vec<String> {
    let mut found = fs::read_dir(store.file().parent().unwrap())
        .map(|dir| {
            dir.map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    found.sort();
    found
}

fn names(settings: &Settings) -> Vec<String> {
    settings
        .targets()
        .iter()
        .map(|target| target.name().to_string())
        .collect()
}

fn add(text: &'static str, port: u16) -> impl FnOnce(&mut Settings) -> Result<bool, TargetError> {
    move |settings| {
        settings.add(target(text, &format!("https://127.0.0.1:{port}")))?;
        Ok(true)
    }
}

/// Makes `dir` read-only and returns it; asserts that a file really cannot be created in it.
fn read_only(dir: &Path) -> PathBuf {
    fs::set_permissions(dir, fs::Permissions::from_mode(0o555)).unwrap();
    assert!(
        fs::write(dir.join("probe"), b"").is_err(),
        "the folder must refuse writes for this case (tests run as a user without root's override)"
    );
    dir.to_owned()
}

fn writable(dir: &Path) {
    fs::set_permissions(dir, fs::Permissions::from_mode(0o755)).unwrap();
}

#[tokio::test]
async fn store_load_without_file_is_the_seed_and_writes_nothing() {
    let (root, store) = store();
    assert_eq!(store.load().await, Ok(seed()));
    assert_eq!(
        store.load().await.unwrap().active().name().as_str(),
        "local"
    );
    assert!(!root.path().join("settings").exists());
}

#[tokio::test]
async fn store_load_after_change_is_the_same_targets_and_active() {
    let (_root, store) = store();
    let changed = store
        .change(|settings| {
            settings.add(target("other", "https://[::1]:9300"))?;
            settings.use_target(&name("other"))
        })
        .await
        .unwrap();
    let loaded = store.load().await.unwrap();
    assert_eq!(loaded, changed);
    assert_eq!(names(&loaded), ["local", "other"]);
    assert_eq!(loaded.active().name().as_str(), "other");
    assert_eq!(loaded.active().endpoint().to_string(), "https://[::1]:9300");
}

#[tokio::test]
async fn store_load_unusable_file_is_the_matching_error_naming_the_file() {
    let mut over = file_json(json!([entry("local", 9297)]), "local");
    over.resize(SETTINGS_CAP as usize + 1, b' ');
    let cases: Vec<(&str, Vec<u8>, &str)> = vec![
        ("over 64 KiB", over, "TooLarge"),
        ("not JSON", format!("{{{MARKER}").into_bytes(), "Malformed"),
        (
            "unknown field",
            serde_json::to_vec(&json!({
                "version": 1, "active": "local", "targets": [entry("local", 9297)], "zq-marker-zq": 1
            }))
            .unwrap(),
            "Malformed",
        ),
        (
            "version 2",
            serde_json::to_vec(&json!({"version": 2, "active": "local", "targets": []})).unwrap(),
            "Version",
        ),
        (
            "duplicate name",
            file_json(json!([entry(MARKER, 9297), entry(MARKER, 9300)]), MARKER),
            "Invalid",
        ),
        ("33 targets", file_json(entries(33), "t0"), "Invalid"),
        (
            "active not held",
            file_json(json!([entry("local", 9297)]), MARKER),
            "Invalid",
        ),
        (
            "localhost endpoint",
            file_json(
                json!([{"name": "local", "endpoint": "https://localhost:9297"}]),
                "local",
            ),
            "Invalid",
        ),
    ];
    for (case, bytes, expected) in cases {
        let (_root, store) = store();
        write_file(&store, &bytes);
        let error = store.load().await.unwrap_err();
        let kind = match &error {
            SettingsError::Unreadable { .. } => "Unreadable",
            SettingsError::TooLarge { .. } => "TooLarge",
            SettingsError::Malformed { .. } => "Malformed",
            SettingsError::Version { .. } => "Version",
            SettingsError::Invalid { .. } => "Invalid",
            SettingsError::WriteFailed { .. } => "WriteFailed",
        };
        assert_eq!(kind, expected, "case {case}");
        assert_message(&error, &store, case);
    }
}

#[tokio::test]
async fn store_load_unreadable_file_is_unreadable_naming_the_file() {
    let (_root, store) = store();
    // A folder where the file should be: it opens but cannot be read as a file.
    fs::create_dir_all(store.file()).unwrap();
    let error = store.load().await.unwrap_err();
    assert!(
        matches!(error, SettingsError::Unreadable { .. }),
        "{error:?}"
    );
    assert_message(&error, &store, "unreadable");
}

fn assert_message(error: &SettingsError, store: &Store, case: &str) {
    let message = error.to_string();
    let file = store.file().display().to_string();
    assert!(message.contains(&file), "case {case}: {message}");
    assert!(
        message.contains("fix or remove it"),
        "case {case}: {message}"
    );
    assert!(!message.contains(MARKER), "case {case}: {message}");
    assert!(!message.contains("localhost"), "case {case}: {message}");
}

#[tokio::test]
async fn store_load_valid_file_of_exactly_64_kib_is_read() {
    let (_root, store) = store();
    let mut bytes = file_json(json!([entry("local", 9297), entry("other", 9300)]), "other");
    bytes.resize(SETTINGS_CAP as usize, b' ');
    write_file(&store, &bytes);
    let loaded = store.load().await.unwrap();
    assert_eq!(names(&loaded), ["local", "other"]);
    assert_eq!(loaded.active().name().as_str(), "other");
}

#[tokio::test]
async fn store_change_without_folder_creates_it_with_the_seed_and_the_change() {
    let (_root, store) = store();
    store.change(add("other", 9300)).await.unwrap();
    let written: Value = serde_json::from_slice(&fs::read(store.file()).unwrap()).unwrap();
    assert_eq!(
        written,
        json!({
            "version": 1,
            "active": "local",
            "targets": [
                {"name": "local", "provider": "aws", "emulator": "aws-emulator",
                 "endpoint": "https://127.0.0.1:9297", "credentials": "emulator-files", "tls": "emulator-ca"},
                {"name": "other", "provider": "aws", "emulator": "aws-emulator",
                 "endpoint": "https://127.0.0.1:9300", "credentials": "emulator-files", "tls": "emulator-ca"},
            ],
        })
    );
    assert_eq!(folder_entries(&store), [SETTINGS_FILE]);
}

#[tokio::test]
async fn store_change_reporting_no_change_writes_nothing() {
    let (root, store) = store();
    let settings = store
        .change(|settings| settings.use_target(&name("local")))
        .await
        .unwrap();
    assert_eq!(settings, seed());
    assert!(!root.path().join("settings").exists());
}

#[tokio::test]
async fn store_change_closure_failing_is_its_error_and_the_file_unchanged() {
    let (_root, store) = store();
    store.change(add("other", 9300)).await.unwrap();
    let before = fs::read(store.file()).unwrap();
    let result = store
        .change(|settings| settings.remove(&name("local")).map(|()| true))
        .await;
    assert_eq!(
        result,
        Err(ChangeError::Target(TargetError::Active {
            name: "local".to_owned()
        }))
    );
    assert_eq!(fs::read(store.file()).unwrap(), before);
}

#[tokio::test]
async fn store_change_unusable_file_is_a_settings_error_and_the_file_unchanged() {
    let (_root, store) = store();
    let before = b"{ not json".to_vec();
    write_file(&store, &before);
    let result = store.change(add("other", 9300)).await;
    assert!(
        matches!(
            result,
            Err(ChangeError::Settings(SettingsError::Malformed { .. }))
        ),
        "{result:?}"
    );
    assert_eq!(fs::read(store.file()).unwrap(), before);
}

#[tokio::test]
async fn store_change_folder_not_writable_is_write_failed_and_leaves_the_old_file() {
    let (_root, store) = store();
    store.change(add("other", 9300)).await.unwrap();
    let before = fs::read(store.file()).unwrap();
    let dir = read_only(store.file().parent().unwrap());
    let result = store.change(add("third", 9301)).await;
    writable(&dir);
    assert!(
        matches!(
            &result,
            Err(ChangeError::Settings(SettingsError::WriteFailed { file, .. })) if *file == store.file()
        ),
        "{result:?}"
    );
    assert_eq!(fs::read(store.file()).unwrap(), before);
    assert_eq!(folder_entries(&store), [SETTINGS_FILE]);
}

#[tokio::test]
async fn store_change_twenty_at_once_loses_none() {
    let (_root, store) = store();
    let store = Arc::new(store);
    let tasks = (0..20u16)
        .map(|index| {
            let store = Arc::clone(&store);
            tokio::spawn(async move {
                let text = format!("t{index}");
                store
                    .change(move |settings| {
                        settings.add(target(&text, "https://127.0.0.1:9300"))?;
                        Ok(true)
                    })
                    .await
            })
        })
        .collect::<Vec<_>>();
    for task in tasks {
        task.await.unwrap().unwrap();
    }
    let mut held = names(&store.load().await.unwrap());
    held.sort();
    let mut expected = (0..20).map(|index| format!("t{index}")).collect::<Vec<_>>();
    expected.push("local".to_owned());
    expected.sort();
    assert_eq!(held, expected);
    assert_eq!(folder_entries(&store), [SETTINGS_FILE]);
}

fn compose() -> Settings {
    Settings::seed(
        name("compose"),
        Endpoint::parse("https://127.0.0.1:9400").unwrap(),
    )
}

#[tokio::test]
async fn store_replace_writes_exactly_the_given_settings_unless_already_held() {
    let other = file_json(json!([entry("local", 9297), entry("other", 9300)]), "other");
    for (case, before, expected) in [
        ("absent", None, Replaced::Created),
        ("other targets", Some(other), Replaced::Replaced),
        ("unusable", Some(b"{ not json".to_vec()), Replaced::Replaced),
    ] {
        let (_root, store) = store();
        if let Some(bytes) = before {
            write_file(&store, &bytes);
        }
        assert_eq!(store.replace(&compose()).await, Ok(expected), "case {case}");
        assert_eq!(store.load().await, Ok(compose()), "case {case}");
        assert_eq!(folder_entries(&store), [SETTINGS_FILE], "case {case}");
    }
}

#[tokio::test]
async fn store_replace_holding_the_settings_already_does_not_write() {
    let (_root, store) = store();
    store.replace(&compose()).await.unwrap();
    // A read-only folder: any write would fail, so `Unchanged` proves none was made.
    let dir = read_only(store.file().parent().unwrap());
    let result = store.replace(&compose()).await;
    writable(&dir);
    assert_eq!(result, Ok(Replaced::Unchanged));
}
