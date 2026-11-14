//! The emulator side: where its files are, what they hold (read only to redact them and to compare runs),
//! a direct health call that bypasses the engine, and own emulators for checks labelled `own-emulator`.

use std::fs;
use std::io::ErrorKind;
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use crate::support::check::{Ctx, Env};
use crate::support::net::free_port_without_emulator;
use crate::support::secrets;
use crate::support::wait::wait_for;

/// How long an emulator may take to answer its own health route after `docker run` or `docker restart`.
const EMULATOR_READY_BOUND: Duration = Duration::from_secs(30);

/// How long a killed emulator's container may take to exit and release its published port.
const KILLED_BOUND: Duration = Duration::from_secs(10);

/// `$HOME/.aws/emulator/<port>`.
pub fn emulator_dir(home: &Path, port: u16) -> PathBuf {
    home.join(".aws").join("emulator").join(port.to_string())
}

/// The secret values of an emulator's files. Reading them registers every value for redaction. There is no
/// `Debug`: the values are compared, never printed.
pub struct EmulatorFiles {
    pub access_key_id: String,
    pub secret_access_key: String,
    /// The base64 lines of every block in `ca.pem`, trimmed.
    pub ca_lines: Vec<String>,
}

impl EmulatorFiles {
    /// Reads `ca.pem` and `emulator_credentials` of the emulator directory `dir`; `None` when either is missing
    /// or the credentials file has no `[default]` with both keys.
    pub fn read(dir: &Path) -> Option<EmulatorFiles> {
        let ca = fs::read_to_string(dir.join("ca.pem")).ok()?;
        let credentials = fs::read_to_string(dir.join("emulator_credentials")).ok()?;
        let ca_lines: Vec<String> = ca
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with("-----"))
            .map(str::to_owned)
            .collect();
        secrets::register(ca_lines.iter().cloned());
        let mut section = String::new();
        let (mut access, mut secret) = (None, None);
        for line in credentials.lines().map(str::trim) {
            if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
                section = name.trim().to_owned();
            } else if let Some((key, value)) = line.split_once('=') {
                let value = value.trim().to_owned();
                secrets::register([value.clone()]);
                if section == "default" {
                    match key.trim() {
                        "aws_access_key_id" => access = Some(value),
                        "aws_secret_access_key" => secret = Some(value),
                        _ => {}
                    }
                }
            }
        }
        Some(EmulatorFiles {
            access_key_id: access?,
            secret_access_key: secret?,
            ca_lines,
        })
    }
}

/// SHA-256 of a file as lowercase hex, from `shasum -a 256` (the integration package has no hash crate).
pub fn sha256_file(path: &Path) -> Result<String, Env> {
    let output = Command::new("shasum")
        .args(["-a", "256"])
        .arg(path)
        .output()
        .map_err(|e| Env::new(format!("cannot run shasum: {e}")))?;
    let text = String::from_utf8_lossy(&output.stdout);
    match text.split_whitespace().next() {
        Some(hex) if output.status.success() && hex.len() == 64 => Ok(hex.to_owned()),
        _ => Err(Env::new(format!("shasum failed on {}", path.display()))),
    }
}

/// `GET https://127.0.0.1:<port>/__admin/health` straight to the emulator, verified against its `ca.pem`, with
/// `curl`. Returns the status and body, or curl's error. Never goes through the engine.
pub fn direct_health(home: &Path, port: u16) -> Result<(u16, Vec<u8>), String> {
    let ca = emulator_dir(home, port).join("ca.pem");
    if !ca.is_file() {
        return Err(format!("{} does not exist", ca.display()));
    }
    let output = Command::new("curl")
        .args(["-q", "-sS", "--noproxy", "*", "--max-time", "5", "--cacert"])
        .arg(&ca)
        .args(["-w", "\n%{http_code}"])
        .arg(format!("https://127.0.0.1:{port}/__admin/health"))
        .env_remove("CURL_HOME")
        .output()
        .map_err(|e| format!("cannot run curl: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "curl: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let stdout = output.stdout;
    let split = stdout
        .iter()
        .rposition(|b| *b == b'\n')
        .ok_or("curl printed no status")?;
    let status = String::from_utf8_lossy(&stdout[split + 1..])
        .trim()
        .parse::<u16>()
        .map_err(|_| "curl printed no status".to_owned())?;
    Ok((status, stdout[..split].to_vec()))
}

fn docker(args: &[&str]) -> Result<String, String> {
    let output = Command::new("docker")
        .args(args)
        .output()
        .map_err(|e| format!("cannot run docker: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    } else {
        Err(format!(
            "docker {}: {}",
            args.first().unwrap_or(&""),
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

/// An emulator container of one check, on a free loopback port whose emulator directory did not exist when the
/// check took it. On drop: `docker stop`, `docker rm -f`, and removal of that directory if it is still there
/// (a kill leaves it), so the guard never deletes files of an emulator it did not start.
pub struct OwnEmulator {
    pub port: u16,
    pub dir: PathBuf,
    name: String,
    home: PathBuf,
}

impl OwnEmulator {
    /// Starts an emulator with telemetry off and waits until it answers `200 ok` on its own health route.
    pub fn start(ctx: &Ctx) -> Result<OwnEmulator, Env> {
        let port = free_port_without_emulator(&ctx.home)?;
        let name = format!("emuforge-it-{port}-{}", ctx.run_id);
        let home = ctx.home.display().to_string();
        let volume = format!("{0}/.aws/emulator:{0}/.aws/emulator", home);
        let publish = format!("127.0.0.1:{port}:{port}");
        let label = format!("emuforge-it-run={}", ctx.run_id);
        let port_arg = port.to_string();
        ctx.log(format!("starting own emulator {name} on 127.0.0.1:{port}"));
        let emulator = OwnEmulator {
            port,
            dir: emulator_dir(&ctx.home, port),
            name: name.clone(),
            home: ctx.home.clone(),
        };
        docker(&[
            "run",
            "-d",
            "--name",
            &name,
            "--label",
            &label,
            "--memory",
            "2g",
            "-p",
            &publish,
            "-e",
            &format!("HOME={home}"),
            "-v",
            &volume,
            "aws-emulator",
            "-p",
            &port_arg,
            "-t",
            "off",
        ])
        .map_err(Env::new)?;
        emulator.wait_ready(ctx)?;
        Ok(emulator)
    }

    /// Waits until the emulator answers `200 ok` on its own health route; registers its files for redaction.
    pub fn wait_ready(&self, ctx: &Ctx) -> Result<(), Env> {
        let ready = wait_for(EMULATOR_READY_BOUND, || {
            match direct_health(&self.home, self.port) {
                Ok((200, body)) if body == b"ok" => Some(()),
                _ => None,
            }
        });
        ready.ok_or_else(|| {
            Env::new(format!(
                "emulator {} did not answer 200 ok on /__admin/health within {}s",
                self.name,
                EMULATOR_READY_BOUND.as_secs()
            ))
        })?;
        EmulatorFiles::read(&self.dir).ok_or_else(|| {
            Env::new(format!(
                "emulator {} is up but its files are incomplete",
                self.name
            ))
        })?;
        ctx.log(format!("own emulator {} answers 200 ok", self.name));
        Ok(())
    }

    /// `docker stop`: SIGTERM; the emulator deletes its files, then exits.
    pub fn stop(&self, ctx: &Ctx) -> Result<(), Env> {
        ctx.log(format!("docker stop {}", self.name));
        docker(&["stop", "-t", "10", &self.name])
            .map(|_| ())
            .map_err(Env::new)
    }

    /// `docker kill`: SIGKILL; the files stay behind with the dead run's keys and certificate. `docker kill`
    /// returns once the signal is sent, so this then waits, with a bound, until the container no longer runs
    /// and `127.0.0.1:<port>` refuses connections (Docker's port forwarder may still accept for a moment).
    /// `Env` when that state is not reached: the check's Given would not hold.
    pub fn kill(&self, ctx: &Ctx) -> Result<(), Env> {
        ctx.log(format!("docker kill {}", self.name));
        docker(&["kill", &self.name]).map_err(Env::new)?;
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, self.port));
        let gone = wait_for(KILLED_BOUND, || {
            let running = docker(&["inspect", "-f", "{{.State.Running}}", &self.name]);
            let refused = matches!(
                TcpStream::connect_timeout(&addr, Duration::from_millis(500)),
                Err(e) if e.kind() == ErrorKind::ConnectionRefused
            );
            (running.as_deref() == Ok("false") && refused).then_some(())
        });
        gone.ok_or_else(|| {
            Env::new(format!(
                "after docker kill, {} still runs or {addr} does not refuse connections within {}s",
                self.name,
                KILLED_BOUND.as_secs()
            ))
        })?;
        ctx.log(format!(
            "{} no longer runs and {addr} refuses connections",
            self.name
        ));
        Ok(())
    }

    /// `docker restart`: a clean stop, then a start that writes a new `ca.pem` and new credentials.
    pub fn restart(&self, ctx: &Ctx) -> Result<(), Env> {
        ctx.log(format!("docker restart {}", self.name));
        docker(&["restart", "-t", "10", &self.name])
            .map(|_| ())
            .map_err(Env::new)
    }
}

impl Drop for OwnEmulator {
    fn drop(&mut self) {
        let _ = docker(&["stop", "-t", "10", &self.name]);
        let _ = docker(&["rm", "-f", &self.name]);
        if self.dir.exists() {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }
}
