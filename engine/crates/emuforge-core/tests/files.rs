use std::fs;
use std::num::NonZeroU16;
use std::path::Path;

use emuforge_core::{CA_FILE, CREDENTIALS_FILE, Emulator, EmulatorFiles, Error, FILE_CAP};
use tempfile::TempDir;

const PORT: u16 = 9391;
const KEY_ID: &str = "emulator-test-key-id";
const SECRET: &str = "emulator-test-secret-value";

fn emulator(home: &Path) -> Emulator {
    Emulator::new(home, NonZeroU16::new(PORT).unwrap())
}

fn certificate_pem() -> String {
    rcgen::generate_simple_self_signed(vec!["127.0.0.1".to_owned()])
        .unwrap()
        .cert
        .pem()
}

fn credentials() -> String {
    format!("[default]\naws_access_key_id = {KEY_ID}\naws_secret_access_key = {SECRET}\n")
}

/// A temp home whose emulator directory holds the given files; `None` leaves a file out.
fn home_with(ca: Option<&[u8]>, credentials: Option<&[u8]>) -> TempDir {
    let home = tempfile::tempdir().unwrap();
    let dir = emulator(home.path()).dir().to_owned();
    fs::create_dir_all(&dir).unwrap();
    if let Some(ca) = ca {
        fs::write(dir.join(CA_FILE), ca).unwrap();
    }
    if let Some(credentials) = credentials {
        fs::write(dir.join(CREDENTIALS_FILE), credentials).unwrap();
    }
    home
}

fn valid_home() -> TempDir {
    home_with(
        Some(certificate_pem().as_bytes()),
        Some(credentials().as_bytes()),
    )
}

async fn read(home: &TempDir) -> Result<EmulatorFiles, Error> {
    EmulatorFiles::read(&emulator(home.path())).await
}

/// Pads `text` with trailing newlines to exactly `len` bytes.
fn padded(text: &str, len: u64) -> Vec<u8> {
    let mut bytes = text.as_bytes().to_vec();
    bytes.resize(usize::try_from(len).unwrap(), b'\n');
    bytes
}

#[tokio::test]
async fn read_valid_files_returns_written_credentials() {
    let home = valid_home();
    let files = read(&home).await.unwrap();
    assert_eq!(files.credentials().access_key_id.expose(), KEY_ID);
    assert_eq!(files.credentials().secret_access_key.expose(), SECRET);
}

#[tokio::test]
async fn read_credentials_with_other_sections_and_spacing_returns_default_values() {
    let text = format!(
        "[other]\naws_access_key_id = other-id\naws_secret_access_key = other-secret\n\n\
         [default]\n  region=us-east-1\naws_access_key_id={KEY_ID}\n\n   aws_secret_access_key   =   {SECRET}   \n\
         extra = value\n[after]\naws_access_key_id = after-id\n"
    );
    let home = home_with(Some(certificate_pem().as_bytes()), Some(text.as_bytes()));
    let files = read(&home).await.unwrap();
    assert_eq!(files.credentials().access_key_id.expose(), KEY_ID);
    assert_eq!(files.credentials().secret_access_key.expose(), SECRET);
}

#[tokio::test]
async fn read_without_port_directory_is_files_missing() {
    let home = tempfile::tempdir().unwrap();
    let error = read(&home).await.unwrap_err();
    assert!(matches!(error, Error::FilesMissing { .. }), "{error:?}");
}

#[tokio::test]
async fn read_without_ca_is_files_missing_ca() {
    let home = home_with(None, Some(credentials().as_bytes()));
    let error = read(&home).await.unwrap_err();
    assert!(
        matches!(error, Error::FilesMissing { file: CA_FILE }),
        "{error:?}"
    );
}

#[tokio::test]
async fn read_without_credentials_is_files_missing_credentials() {
    let home = home_with(Some(certificate_pem().as_bytes()), None);
    let error = read(&home).await.unwrap_err();
    assert!(
        matches!(
            error,
            Error::FilesMissing {
                file: CREDENTIALS_FILE
            }
        ),
        "{error:?}"
    );
}

#[tokio::test]
async fn read_ca_without_certificate_block_is_malformed_ca() {
    let private_key = rcgen::KeyPair::generate().unwrap().serialize_pem();
    let cases = [
        ("empty", String::new()),
        ("only text", "this is not a certificate\n".to_owned()),
        ("only a private key block", private_key),
    ];
    for (name, ca) in cases {
        let home = home_with(Some(ca.as_bytes()), Some(credentials().as_bytes()));
        let error = read(&home).await.unwrap_err();
        assert!(
            matches!(error, Error::FileMalformed { file: CA_FILE }),
            "case {name}: {error:?}"
        );
    }
}

#[tokio::test]
async fn read_credentials_without_both_default_keys_is_malformed_credentials() {
    let cases = [
        (
            "no default section",
            format!("aws_access_key_id = {KEY_ID}\naws_secret_access_key = {SECRET}\n"),
        ),
        (
            "lacks aws_access_key_id",
            format!("[default]\naws_secret_access_key = {SECRET}\n"),
        ),
        (
            "lacks aws_secret_access_key",
            format!("[default]\naws_access_key_id = {KEY_ID}\n"),
        ),
        (
            "empty value",
            format!("[default]\naws_access_key_id =\naws_secret_access_key = {SECRET}\n"),
        ),
        (
            "keys only in another section",
            format!(
                "[default]\nregion = us-east-1\n[profile other]\naws_access_key_id = {KEY_ID}\n\
                 aws_secret_access_key = {SECRET}\n"
            ),
        ),
    ];
    for (name, text) in cases {
        let home = home_with(Some(certificate_pem().as_bytes()), Some(text.as_bytes()));
        let error = read(&home).await.unwrap_err();
        assert!(
            matches!(
                error,
                Error::FileMalformed {
                    file: CREDENTIALS_FILE
                }
            ),
            "case {name}: {error:?}"
        );
    }
}

#[tokio::test]
async fn read_files_of_exactly_the_cap_is_ok() {
    let home = home_with(
        Some(&padded(&certificate_pem(), FILE_CAP)),
        Some(&padded(&credentials(), FILE_CAP)),
    );
    let files = read(&home).await.unwrap();
    assert_eq!(files.credentials().access_key_id.expose(), KEY_ID);
}

#[tokio::test]
async fn read_file_one_byte_past_the_cap_is_unreadable_naming_it() {
    let ca = certificate_pem();
    let credentials = credentials();
    let over = FILE_CAP + 1;
    let cases = [
        (
            CA_FILE,
            home_with(Some(&padded(&ca, over)), Some(credentials.as_bytes())),
        ),
        (
            CREDENTIALS_FILE,
            home_with(Some(ca.as_bytes()), Some(&padded(&credentials, over))),
        ),
    ];
    for (name, home) in cases {
        let error = read(&home).await.unwrap_err();
        assert!(
            matches!(error, Error::FileUnreadable { file, .. } if file == name),
            "case {name}: {error:?}"
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn read_file_without_permission_is_unreadable_naming_it() {
    use std::os::unix::fs::PermissionsExt;
    for name in [CA_FILE, CREDENTIALS_FILE] {
        let home = valid_home();
        let path = emulator(home.path()).dir().join(name);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
        let error = read(&home).await.unwrap_err();
        assert!(
            matches!(error, Error::FileUnreadable { file, .. } if file == name),
            "case {name}: {error:?}"
        );
    }
}

fn write_decoys(home: &Path) {
    let aws = home.join(".aws");
    fs::create_dir_all(&aws).unwrap();
    fs::write(
        aws.join("credentials"),
        "[default]\naws_access_key_id = decoy-key-id\naws_secret_access_key = decoy-secret\n",
    )
    .unwrap();
    fs::write(
        aws.join("config"),
        "[default]\nregion = eu-west-1\naws_access_key_id = decoy-config-key-id\n",
    )
    .unwrap();
}

#[tokio::test]
async fn read_with_only_decoy_aws_files_is_files_missing() {
    let home = tempfile::tempdir().unwrap();
    write_decoys(home.path());
    let error = read(&home).await.unwrap_err();
    assert!(matches!(error, Error::FilesMissing { .. }), "{error:?}");
}

#[tokio::test]
async fn read_with_decoy_aws_files_returns_emulator_values() {
    let home = valid_home();
    write_decoys(home.path());
    let files = read(&home).await.unwrap();
    assert_eq!(files.credentials().access_key_id.expose(), KEY_ID);
    assert_eq!(files.credentials().secret_access_key.expose(), SECRET);
}

#[tokio::test]
async fn credentials_print_redacted_without_values() {
    let home = valid_home();
    let files = read(&home).await.unwrap();
    let credentials = files.credentials();
    let printed = [
        format!("{credentials:?}"),
        format!("{}", credentials.access_key_id),
        format!("{}", credentials.secret_access_key),
        format!("{:?}", credentials.secret_access_key),
        format!("{files:?}"),
    ];
    for text in printed {
        assert!(text.contains("[redacted]"), "{text}");
        assert!(!text.contains(KEY_ID) && !text.contains(SECRET), "{text}");
    }
}

#[tokio::test]
async fn error_display_for_malformed_credentials_names_file_without_value() {
    let text = format!("[default]\naws_access_key_id = {KEY_ID}\n");
    let home = home_with(Some(certificate_pem().as_bytes()), Some(text.as_bytes()));
    let message = read(&home).await.unwrap_err().to_string();
    assert!(message.contains(CREDENTIALS_FILE), "{message}");
    assert!(!message.contains(KEY_ID), "{message}");
}
