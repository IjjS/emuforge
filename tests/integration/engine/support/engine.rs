//! The engine process under test.
//!
//! An engine starts with an empty environment plus `HOME`, `PATH`, `EMUFORGE_ENGINE_PORT=<engine port>` and
//! `EMULATOR_PORT=<run's emulator port>`; a check adds or removes exactly what its criteria line names. Its
//! stdout and stderr are captured whole. A missing binary, or one that cannot be spawned, is a failed assertion
//! ("engine binary missing at <path>"), never an exit status, so no "exits non-zero" case passes without an
//! engine.

use std::collections::BTreeMap;
use std::io::Read;
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::support::check::{Ctx, Env};
use crate::support::net::ensure_port_free;
use crate::support::secrets;
use crate::support::wait::wait_for;

/// How long a started engine may take to accept a connection on its port.
const LISTEN_BOUND: Duration = Duration::from_secs(10);

pub struct EngineCmd {
    args: Vec<String>,
    env: BTreeMap<String, String>,
    /// The port this engine is expected to listen on, for readiness and the "nothing listens" checks.
    pub port: u16,
}

impl EngineCmd {
    pub fn new(ctx: &Ctx) -> EngineCmd {
        let mut env = BTreeMap::new();
        env.insert("HOME".to_owned(), ctx.home.display().to_string());
        env.insert("PATH".to_owned(), std::env::var("PATH").unwrap_or_default());
        env.insert(
            "EMUFORGE_ENGINE_PORT".to_owned(),
            ctx.engine_port.to_string(),
        );
        env.insert("EMULATOR_PORT".to_owned(), ctx.emulator_port.to_string());
        EngineCmd {
            args: Vec::new(),
            env,
            port: ctx.engine_port,
        }
    }

    pub fn arg(mut self, arg: impl Into<String>) -> EngineCmd {
        self.args.push(arg.into());
        self
    }

    pub fn env(mut self, name: &str, value: impl Into<String>) -> EngineCmd {
        self.env.insert(name.to_owned(), value.into());
        self
    }

    pub fn env_remove(mut self, name: &str) -> EngineCmd {
        self.env.remove(name);
        self
    }

    /// The port this engine listens on when it differs from the engine port (for readiness waits only; the
    /// setting itself is passed with `arg` or `env`).
    pub fn listening_on(mut self, port: u16) -> EngineCmd {
        self.port = port;
        self
    }

    /// Spawns the engine and returns at once. Panics when there is no binary to spawn.
    pub fn spawn(self, ctx: &Ctx) -> Engine {
        let bin = &ctx.engine_bin;
        if let Some(why) = &ctx.engine_missing {
            panic!("engine binary missing at {} ({why})", bin.display());
        }
        if !bin.is_file() {
            panic!("engine binary missing at {}", bin.display());
        }
        let shown_env: Vec<String> = self
            .env
            .iter()
            .filter(|(k, _)| *k != "PATH")
            .map(|(k, v)| format!("{k}={v}"))
            .collect();
        ctx.log(format!(
            "spawn {} {} with {}",
            bin.display(),
            self.args.join(" "),
            shown_env.join(" ")
        ));
        let mut child = Command::new(bin)
            .args(&self.args)
            .env_clear()
            .envs(&self.env)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap_or_else(|e| {
                panic!(
                    "engine binary missing at {}: cannot spawn it: {e}",
                    bin.display()
                )
            });
        let (stdout, stdout_done) = capture(child.stdout.take());
        let (stderr, stderr_done) = capture(child.stderr.take());
        Engine {
            pid: child.id(),
            child,
            port: self.port,
            stdout,
            stderr,
            done: vec![stdout_done, stderr_done],
            started: Instant::now(),
            stopped: false,
        }
    }
}

fn capture<R: Read + Send + 'static>(pipe: Option<R>) -> (Arc<Mutex<Vec<u8>>>, Receiver<()>) {
    let buffer = Arc::new(Mutex::new(Vec::new()));
    let (tx, rx) = mpsc::channel();
    let sink = buffer.clone();
    std::thread::spawn(move || {
        if let Some(mut pipe) = pipe {
            let mut chunk = [0u8; 4096];
            while let Ok(n) = pipe.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                sink.lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .extend_from_slice(&chunk[..n]);
            }
        }
        let _ = tx.send(());
    });
    (buffer, rx)
}

/// What an engine wrote, complete once it has exited.
pub struct Output {
    pub stdout: String,
    pub stderr: String,
}

pub struct Engine {
    pub pid: u32,
    pub port: u16,
    pub started: Instant,
    child: Child,
    stdout: Arc<Mutex<Vec<u8>>>,
    stderr: Arc<Mutex<Vec<u8>>>,
    done: Vec<Receiver<()>>,
    stopped: bool,
}

impl Engine {
    /// Spawns the engine and waits until it accepts a connection on its port. The port must be free before
    /// (`Env` otherwise). Panics when the engine exits or does not listen within the bound.
    pub fn start(ctx: &Ctx, cmd: EngineCmd) -> Result<Engine, Env> {
        ensure_port_free(cmd.port)?;
        let mut engine = cmd.spawn(ctx);
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, engine.port));
        let ready = wait_for(LISTEN_BOUND, || {
            if let Ok(Some(status)) = engine.child.try_wait() {
                return Some(Err(status));
            }
            TcpStream::connect_timeout(&addr, Duration::from_millis(500))
                .ok()
                .map(|_| Ok(()))
        });
        match ready {
            Some(Ok(())) => {
                ctx.log(format!("engine pid {} listens on {addr}", engine.pid));
                Ok(engine)
            }
            Some(Err(status)) => {
                let out = engine.stop(ctx);
                panic!(
                    "engine exited ({status}) before listening on {addr}; stderr: {}",
                    out.stderr.trim()
                );
            }
            None => panic!(
                "engine did not listen on {addr} within {}s",
                LISTEN_BOUND.as_secs()
            ),
        }
    }

    pub fn is_running(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    /// Waits until the engine exits, at most `bound` after it was spawned. On each poll it also tries
    /// `127.0.0.1:<port>`, so a caller can tell whether anything listened there meanwhile.
    pub fn wait_exit(&mut self, bound: Duration) -> (Option<ExitStatus>, bool) {
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, self.port));
        let mut listened = false;
        let left = bound.saturating_sub(self.started.elapsed());
        let status = wait_for(left, || {
            if TcpStream::connect_timeout(&addr, Duration::from_millis(100)).is_ok() {
                listened = true;
            }
            self.child.try_wait().ok().flatten()
        });
        (status, listened)
    }

    /// stderr so far.
    pub fn stderr_now(&self) -> String {
        String::from_utf8_lossy(&self.stderr.lock().unwrap_or_else(|e| e.into_inner())).into_owned()
    }

    /// Kills the engine if it still runs, collects both streams in full and writes them, redacted, to the
    /// check's log.
    pub fn stop(&mut self, ctx: &Ctx) -> Output {
        if !self.stopped {
            let _ = self.child.kill();
            let _ = self.child.wait();
            for done in &self.done {
                let _ = done.recv_timeout(Duration::from_secs(5));
            }
            self.stopped = true;
        }
        let output = Output {
            stdout: String::from_utf8_lossy(&self.stdout.lock().unwrap_or_else(|e| e.into_inner()))
                .into_owned(),
            stderr: self.stderr_now(),
        };
        ctx.log(format!(
            "engine pid {} stopped; stdout:\n{}\nstderr:\n{}",
            self.pid,
            secrets::redact(&output.stdout),
            secrets::redact(&output.stderr)
        ));
        output
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        if !self.stopped {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}
