//! The settings file `targets.json`: the targets and the active one, read whole at every use and written whole
//! by renaming a new file over the old one.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

use crate::target::{MAX_TARGETS, Settings, Target, TargetError, TargetForm, TargetName};

/// The settings file's name in the settings folder.
pub const SETTINGS_FILE: &str = "targets.json";
/// The settings file is read no further than this many bytes.
pub const SETTINGS_CAP: u64 = 64 * 1024;
/// The one version of the file's form this engine reads and writes.
pub const SETTINGS_VERSION: u64 = 1;

/// Why the settings file cannot be used or written. Every message names the file and what to do; none holds the
/// file's text.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SettingsError {
    #[error("the settings file {} cannot be read ({kind}); fix or remove it", .file.display())]
    Unreadable { file: PathBuf, kind: io::ErrorKind },
    #[error("the settings file {} is larger than {SETTINGS_CAP} bytes; fix or remove it", .file.display())]
    TooLarge { file: PathBuf },
    #[error("the settings file {} is not in the expected form ({detail}); fix or remove it", .file.display())]
    Malformed { file: PathBuf, detail: String },
    #[error(
        "the settings file {} has version {found}, this engine reads version {SETTINGS_VERSION}; fix or remove it",
        .file.display()
    )]
    Version { file: PathBuf, found: u64 },
    #[error("the settings file {} is not valid: {detail}; fix or remove it", .file.display())]
    Invalid { file: PathBuf, detail: String },
    #[error(
        "the settings file {} cannot be written ({kind}); make its folder writable and try again",
        .file.display()
    )]
    WriteFailed { file: PathBuf, kind: io::ErrorKind },
}

/// Why a change of the settings did not happen.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ChangeError {
    #[error(transparent)]
    Settings(SettingsError),
    #[error(transparent)]
    Target(TargetError),
}

/// What [`Store::replace`] did to the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Replaced {
    /// There was no file; it was written.
    Created,
    /// The file held something else, or could not be used; it was written over.
    Replaced,
    /// The file already held the settings; nothing was written.
    Unchanged,
}

/// The settings folder, and the settings used while its file is absent.
#[derive(Debug)]
pub struct Store {
    dir: PathBuf,
    seed: Settings,
    lock: Mutex<()>,
}

/// Numbers this process's temp files, so two writes never share one.
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// The file's form: `{"version":1,"active":"…","targets":[…]}`.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FileForm {
    version: u64,
    active: String,
    targets: Vec<TargetForm>,
}

#[derive(Serialize)]
struct FileView<'a> {
    version: u64,
    active: &'a TargetName,
    targets: &'a [Target],
}

/// Only the version, to tell a file of another version from a broken one.
#[derive(Deserialize)]
struct VersionOnly {
    version: u64,
}

impl Store {
    pub fn new(dir: PathBuf, seed: Settings) -> Store {
        Store {
            dir,
            seed,
            lock: Mutex::new(()),
        }
    }

    /// `<settings folder>/targets.json`.
    pub fn file(&self) -> PathBuf {
        self.dir.join(SETTINGS_FILE)
    }

    /// The settings in the file, or the seed when there is no file. Nothing is written.
    pub async fn load(&self) -> Result<Settings, SettingsError> {
        Ok(self.read().await?.unwrap_or_else(|| self.seed.clone()))
    }

    /// Applies `change` to the settings as they are now and writes them only if it reports a change. One change
    /// at a time per store. An unusable file is never written over.
    pub async fn change<F>(&self, change: F) -> Result<Settings, ChangeError>
    where
        F: FnOnce(&mut Settings) -> Result<bool, TargetError>,
    {
        let _held = self.lock.lock().await;
        let mut settings = self.load().await.map_err(ChangeError::Settings)?;
        if change(&mut settings).map_err(ChangeError::Target)? {
            self.write(&settings).await.map_err(ChangeError::Settings)?;
        }
        Ok(settings)
    }

    /// Makes the file hold exactly `settings`, whatever it holds now (an unusable file included), writing only
    /// when it does not already.
    pub async fn replace(&self, settings: &Settings) -> Result<Replaced, SettingsError> {
        let _held = self.lock.lock().await;
        let replaced = match self.read().await {
            Ok(Some(current)) if &current == settings => return Ok(Replaced::Unchanged),
            Ok(None) => Replaced::Created,
            Ok(Some(_)) | Err(_) => Replaced::Replaced,
        };
        self.write(settings).await?;
        Ok(replaced)
    }

    /// The file's settings, `None` when it does not exist.
    async fn read(&self) -> Result<Option<Settings>, SettingsError> {
        let file = self.file();
        let unreadable = |error: io::Error| SettingsError::Unreadable {
            file: file.clone(),
            kind: error.kind(),
        };
        let opened = match tokio::fs::File::open(&file).await {
            Ok(opened) => opened,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(unreadable(error)),
        };
        let mut bytes = Vec::new();
        opened
            .take(SETTINGS_CAP + 1)
            .read_to_end(&mut bytes)
            .await
            .map_err(unreadable)?;
        if bytes.len() as u64 > SETTINGS_CAP {
            return Err(SettingsError::TooLarge { file });
        }
        parse(&file, &bytes).map(Some)
    }

    async fn write(&self, settings: &Settings) -> Result<(), SettingsError> {
        let file = self.file();
        let failed = |error: io::Error| SettingsError::WriteFailed {
            file: file.clone(),
            kind: error.kind(),
        };
        let mut bytes = serde_json::to_vec_pretty(&FileView {
            version: SETTINGS_VERSION,
            active: settings.active().name(),
            targets: settings.targets(),
        })
        .map_err(|error| failed(error.into()))?;
        bytes.push(b'\n');
        tokio::fs::create_dir_all(&self.dir).await.map_err(failed)?;
        let temp = self.dir.join(format!(
            "{SETTINGS_FILE}.{}.{}.tmp",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        if let Err(error) = write_then_rename(&temp, &file, &bytes).await {
            // The temp file may not exist; the write's own error is the one reported.
            let _ = tokio::fs::remove_file(&temp).await;
            return Err(failed(error));
        }
        Ok(())
    }
}

async fn write_then_rename(temp: &Path, file: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut out = tokio::fs::File::create(temp).await?;
    out.write_all(bytes).await?;
    out.flush().await?;
    out.sync_all().await?;
    drop(out);
    tokio::fs::rename(temp, file).await
}

/// The file's bytes, checked whole: its form, its version, then every target and the settings' invariants.
fn parse(file: &Path, bytes: &[u8]) -> Result<Settings, SettingsError> {
    let form: FileForm = match serde_json::from_slice(bytes) {
        Ok(form) => form,
        Err(error) => {
            return Err(match serde_json::from_slice::<VersionOnly>(bytes) {
                Ok(VersionOnly { version }) if version != SETTINGS_VERSION => {
                    SettingsError::Version {
                        file: file.to_owned(),
                        found: version,
                    }
                }
                _ => malformed(file, &error),
            });
        }
    };
    if form.version != SETTINGS_VERSION {
        return Err(SettingsError::Version {
            file: file.to_owned(),
            found: form.version,
        });
    }
    let invalid = |error: TargetError| SettingsError::Invalid {
        file: file.to_owned(),
        detail: in_file(&error),
    };
    let targets = form
        .targets
        .into_iter()
        .map(TargetForm::into_target)
        .collect::<Result<Vec<_>, _>>()
        .map_err(invalid)?;
    let active = TargetName::parse(&form.active).map_err(invalid)?;
    Settings::new(&active, targets).map_err(invalid)
}

/// Where and what kind of fault, never the text around it (serde's message can quote the file).
fn malformed(file: &Path, error: &serde_json::Error) -> SettingsError {
    let kind = match error.classify() {
        serde_json::error::Category::Io => "read error",
        serde_json::error::Category::Syntax => "not JSON",
        serde_json::error::Category::Data => "a field missing, unknown or of the wrong type",
        serde_json::error::Category::Eof => "ends early",
    };
    SettingsError::Malformed {
        file: file.to_owned(),
        detail: format!("line {} column {}: {kind}", error.line(), error.column()),
    }
}

/// A refusal as said of the file: fixed words and field names, never a name or value the file holds.
fn in_file(error: &TargetError) -> String {
    match error {
        TargetError::Invalid { field, why } => format!("a target's {field} is not valid: {why}"),
        TargetError::NotLoopback => {
            "a target's endpoint is not https:// with a loopback IP address and a port".to_owned()
        }
        TargetError::Exists { .. } => "two targets have the same name".to_owned(),
        TargetError::Limit => format!("it holds more than {MAX_TARGETS} targets"),
        TargetError::NotFound { .. } => "the active name is not one of its targets".to_owned(),
        TargetError::Active { .. } => "the active target is refused".to_owned(),
    }
}
