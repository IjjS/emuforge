//! The check contract.
//!
//! `check("<id>", |ctx| { ... })` runs one check and writes `<verdicts>/<id>.json`:
//!
//! - `passed` when the closure returns `Ok(())`;
//! - `error` when it returns `Err(Env)`: the environment failed (an emulator would not start, a port could not
//!   be taken), so the run says nothing about the engine;
//! - `failed` when an assertion panics or a bounded wait runs out.
//!
//! Then it panics unless the verdict is `passed`, so `cargo test` reports the check as failing too.
//!
//! The process environment it reads (set by `tests/integration/run`, or by hand for one `cargo test`):
//!
//! | Variable | Meaning |
//! |---|---|
//! | `EMUFORGE_IT_VERDICTS` | directory for verdict files; logs go to its sibling `logs/` |
//! | `EMUFORGE_IT_ENGINE_BIN` | the engine binary under test |
//! | `EMUFORGE_IT_ENGINE_BUILD` | `ok`, `absent` or `failed`; anything but `ok` means there is no engine to run |
//! | `EMULATOR_PORT` | the run's emulator, already started |
//! | `EMUFORGE_ENGINE_PORT` | the port every engine a check starts listens on |
//! | `EMUFORGE_IT_RUN_ID` | unique per run; names the containers a check starts |

use std::fs::{self, File};
use std::io::Write as _;
use std::net::IpAddr;
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, Once};
use std::time::Instant;

use crate::support::emulator::{EmulatorFiles, emulator_dir};
use crate::support::secrets;

/// The environment failed; the check could not run. Becomes verdict `error`.
#[derive(Debug)]
pub struct Env(pub String);

impl Env {
    pub fn new(message: impl Into<String>) -> Env {
        Env(message.into())
    }
}

/// What a check gets to work with. Helpers take `&Ctx` so they can log and enforce the destination rule.
pub struct Ctx {
    pub id: &'static str,
    /// `$HOME` of the run; the emulator writes its files under `$HOME/.aws/emulator/<port>/`.
    pub home: PathBuf,
    /// The run's emulator, started by `run` before any check.
    pub emulator_port: u16,
    /// The port an engine started by a check listens on.
    pub engine_port: u16,
    pub engine_bin: PathBuf,
    /// Why there is no engine binary to run, when `run` knows it.
    pub engine_missing: Option<String>,
    pub run_id: String,
    out_dir: PathBuf,
    started: Instant,
    log: Mutex<File>,
    allowed: Vec<IpAddr>,
}

impl Ctx {
    /// Appends a line to the check's log, with secrets redacted.
    pub fn log(&self, line: impl AsRef<str>) {
        let line = secrets::redact(line.as_ref());
        let elapsed = self.started.elapsed().as_secs_f64();
        let mut file = self.log.lock().unwrap_or_else(|e| e.into_inner());
        let _ = writeln!(file, "[{elapsed:8.3}s] {line}");
    }

    /// Lets this check connect to one non-loopback address of this host. Only `engine.binds-loopback-only`
    /// calls it (design §8): the connection goes to the host's own interface and never leaves the host.
    pub fn allow_own_address(&mut self, ip: IpAddr) {
        assert_eq!(
            self.id, "engine.binds-loopback-only",
            "only engine.binds-loopback-only may connect to a non-loopback address"
        );
        self.log(format!(
            "destination {ip} allowed for this check (this host's own interface address)"
        ));
        self.allowed.push(ip);
    }

    /// Panics before connecting when `ip` is neither loopback nor an address this check was allowed.
    pub fn refuse_foreign_destination(&self, ip: IpAddr) {
        assert!(
            ip.is_loopback() || self.allowed.contains(&ip),
            "refused to connect to {ip}: checks reach only loopback addresses"
        );
    }

    /// A fresh directory for this check under the run's output, removed when the guard drops.
    pub fn temp_dir(&self) -> Result<TempDir, Env> {
        let path = self.out_dir.join("tmp").join(self.id);
        if path.exists() {
            fs::remove_dir_all(&path)
                .map_err(|e| Env::new(format!("cannot clear {}: {e}", path.display())))?;
        }
        fs::create_dir_all(&path)
            .map_err(|e| Env::new(format!("cannot create {}: {e}", path.display())))?;
        Ok(TempDir { path })
    }
}

/// A directory removed on drop.
pub struct TempDir {
    pub path: PathBuf,
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn var(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|_| format!("{name} is not set"))
}

fn port_var(name: &str) -> Result<u16, String> {
    let value = var(name)?;
    value
        .parse::<u16>()
        .ok()
        .filter(|p| *p != 0)
        .ok_or_else(|| format!("{name}={value} is not a port"))
}

fn install_redacting_panic_hook() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        panic::set_hook(Box::new(|info| {
            let message = info.payload_as_str().unwrap_or("(no message)");
            let location = info.location().map(|l| l.to_string()).unwrap_or_default();
            eprintln!(
                "assertion failed at {location}: {}",
                secrets::redact(message)
            );
        }));
    });
}

/// Runs one check; see the module documentation.
pub fn check(id: &'static str, body: impl FnOnce(&mut Ctx) -> Result<(), Env>) {
    install_redacting_panic_hook();
    let verdicts = PathBuf::from(var("EMUFORGE_IT_VERDICTS").unwrap_or_else(|e| panic!("{e}")));
    let out_dir = verdicts
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| verdicts.clone());
    let logs = out_dir.join("logs");
    fs::create_dir_all(&verdicts)
        .unwrap_or_else(|e| panic!("cannot create {}: {e}", verdicts.display()));
    fs::create_dir_all(&logs).unwrap_or_else(|e| panic!("cannot create {}: {e}", logs.display()));
    let log_path = logs.join(format!("{id}.log"));
    let started = Instant::now();

    let (verdict, message) = match context(id, out_dir, &log_path, started) {
        Err(e) => ("error", e),
        Ok(mut ctx) => {
            ctx.log(format!(
                "check {id}: emulator port {}, engine port {}, engine {}",
                ctx.emulator_port,
                ctx.engine_port,
                ctx.engine_bin.display()
            ));
            let outcome = panic::catch_unwind(AssertUnwindSafe(|| body(&mut ctx)));
            let (verdict, message) = match outcome {
                Ok(Ok(())) => ("passed", String::new()),
                Ok(Err(Env(e))) => ("error", e),
                Err(payload) => {
                    let text = payload
                        .downcast_ref::<String>()
                        .cloned()
                        .or_else(|| payload.downcast_ref::<&str>().map(|s| (*s).to_owned()))
                        .unwrap_or_else(|| "(no message)".to_owned());
                    ("failed", text)
                }
            };
            ctx.log(format!("verdict {verdict} {message}"));
            (verdict, message)
        }
    };

    let message = secrets::redact(&message);
    let record = serde_json::json!({
        "check_id": id,
        "verdict": verdict,
        "seconds": (started.elapsed().as_secs_f64() * 10.0).round() / 10.0,
        "log": log_path.display().to_string(),
        "message": message,
    });
    let file = verdicts.join(format!("{id}.json"));
    fs::write(&file, record.to_string())
        .unwrap_or_else(|e| panic!("cannot write {}: {e}", file.display()));

    if verdict != "passed" {
        panic!("{id}: {verdict}: {message}");
    }
}

fn context(
    id: &'static str,
    out_dir: PathBuf,
    log_path: &Path,
    started: Instant,
) -> Result<Ctx, String> {
    let log =
        File::create(log_path).map_err(|e| format!("cannot create {}: {e}", log_path.display()))?;
    let home = PathBuf::from(var("HOME")?);
    let emulator_port = port_var("EMULATOR_PORT")?;
    let engine_port = port_var("EMUFORGE_ENGINE_PORT")?;
    let engine_bin = PathBuf::from(var("EMUFORGE_IT_ENGINE_BIN")?);
    let engine_missing = match std::env::var("EMUFORGE_IT_ENGINE_BUILD").ok().as_deref() {
        None | Some("ok") => None,
        Some("absent") => Some("engine/Cargo.toml does not exist".to_owned()),
        Some(other) => Some(format!(
            "engine build {other}, see output/logs/integration-engine-build.log"
        )),
    };
    let run_id =
        std::env::var("EMUFORGE_IT_RUN_ID").unwrap_or_else(|_| std::process::id().to_string());
    // The run's emulator keys and certificate are redacted from everything written from here on.
    let _ = EmulatorFiles::read(&emulator_dir(&home, emulator_port));
    Ok(Ctx {
        id,
        home,
        emulator_port,
        engine_port,
        engine_bin,
        engine_missing,
        run_id,
        out_dir,
        started,
        log: Mutex::new(log),
        allowed: Vec::new(),
    })
}
