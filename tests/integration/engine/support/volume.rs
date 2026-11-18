//! Emulators of the image `aws-emulator:<tag>` (`Ctx::image_tag`) started on a Docker volume instead of the host folder (issue 55). A volume
//! shows real owners and modes on Docker Desktop and on Docker Engine on Linux alike, so a check sees the
//! filesystem of a Linux host on any machine.
//!
//! Every volume and container here carries the label `emuforge-it-run=<run id>` and a name with the run id, and is
//! removed when its guard drops; `tests/integration/run` removes what a killed check left. Nothing is published:
//! each emulator has its own network namespace (`--network none`) and is reached by a one-shot container that
//! joins it. No file of an emulator is opened for its content here; owners, modes and names are all this reads.

use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use crate::support::check::{Ctx, Env};
use crate::support::wait::wait_for;

/// `HOME` of every emulator started on a volume.
pub const VOLUME_HOME: &str = "/home/emuforge-it";
/// Where the volume is mounted: the emulator's folder under `VOLUME_HOME`.
pub const VOLUME_FOLDER: &str = "/home/emuforge-it/.aws/emulator";
/// The emulator's port inside its own network namespace. Nothing is published, so it takes no host port.
pub const VOLUME_PORT: u16 = 9399;
/// The four files an emulator writes into its port folder.
pub const EMULATOR_FILES: [&str; 4] =
    ["ca.pem", "config", "emulator_credentials", "truststore.p12"];

/// How long an emulator may take to answer the health call after `docker run` or `docker restart`.
pub const READY_BOUND: Duration = Duration::from_secs(30);

/// Numbers the one-shot containers of a check process, so each has its own name.
static SEQUENCE: AtomicU32 = AtomicU32::new(0);

/// What a `docker` command printed and how it ended.
pub struct Docker {
    pub success: bool,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// Runs `docker <args>`; `Err` only when `docker` itself cannot be run.
pub fn docker(args: &[&str]) -> Result<Docker, Env> {
    let output = Command::new("docker")
        .args(args)
        .output()
        .map_err(|e| Env::new(format!("cannot run docker: {e}")))?;
    Ok(Docker {
        success: output.status.success(),
        code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

/// `docker <args>` that must succeed; its standard output, trimmed. A failure is the environment's.
fn docker_ok(args: &[&str]) -> Result<String, Env> {
    let out = docker(args)?;
    if out.success {
        Ok(out.stdout.trim().to_owned())
    } else {
        Err(Env::new(format!(
            "docker {}: {}",
            args.first().unwrap_or(&""),
            out.stderr.trim()
        )))
    }
}

fn label(ctx: &Ctx) -> String {
    format!("emuforge-it-run={}", ctx.run_id)
}

/// `<VOLUME_FOLDER>/<VOLUME_PORT>`.
pub fn port_folder() -> String {
    format!("{VOLUME_FOLDER}/{VOLUME_PORT}")
}

/// One file of the port folder.
pub fn port_file(name: &str) -> String {
    format!("{}/{name}", port_folder())
}

/// A Docker volume made by the check, its root given an owner and a mode. Removed on drop; drop every container
/// that mounts it first.
pub struct Volume {
    pub name: String,
    run_label: String,
    run_id: String,
    image_tag: String,
}

impl Volume {
    /// `docker volume create`, then a one-shot root container gives the volume's root `owner` (`uid:gid`) and
    /// `mode` (octal, as `chmod` takes it).
    pub fn create(ctx: &Ctx, tag: &str, owner: &str, mode: &str) -> Result<Volume, Env> {
        let name = format!("emuforge-it-img-{tag}-{}", ctx.run_id);
        let run_label = label(ctx);
        docker_ok(&["volume", "create", "--label", &run_label, &name])?;
        let volume = Volume {
            name,
            run_label,
            run_id: ctx.run_id.clone(),
            image_tag: ctx.image_tag.clone(),
        };
        let given = volume.one_shot(
            "0:0",
            "none",
            "sh",
            &[
                "-c",
                r#"chown "$1" "$3" && chmod "$2" "$3""#,
                "sh",
                owner,
                mode,
                VOLUME_FOLDER,
            ],
        )?;
        if !given.success {
            return Err(Env::new(format!(
                "cannot give volume {} the owner {owner} and mode {mode}: {}",
                volume.name,
                given.stderr.trim()
            )));
        }
        ctx.log(format!(
            "volume {} made, its root {owner} mode {mode}",
            volume.name
        ));
        Ok(volume)
    }

    /// `-v <volume>:<VOLUME_FOLDER>`.
    pub fn mount(&self) -> String {
        format!("{}:{VOLUME_FOLDER}", self.name)
    }

    /// A one-shot container of the image, run as `user` (`uid:gid`) on `network` (`none` or
    /// `container:<name>`) with the volume mounted, running `entrypoint args`; removed when it ends.
    pub fn one_shot(
        &self,
        user: &str,
        network: &str,
        entrypoint: &str,
        args: &[&str],
    ) -> Result<Docker, Env> {
        let n = SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let name = format!(
            "emuforge-it-img-once-{}-{n}-{}",
            std::process::id(),
            self.run_id
        );
        let mount = self.mount();
        let image = format!("aws-emulator:{}", self.image_tag);
        let mut all = vec![
            "run",
            "--pull",
            "never",
            "--rm",
            "--name",
            &name,
            "--label",
            &self.run_label,
            "--user",
            user,
            "--network",
            network,
            "-v",
            &mount,
            "--entrypoint",
            entrypoint,
            &image,
        ];
        all.extend_from_slice(args);
        docker(&all)
    }

    /// Owner and mode of each path, read with `stat` by a one-shot root container: `uid:gid` and the octal mode
    /// without leading zeros (`700`). `Err` with `stat`'s message when a path cannot be read.
    pub fn stat(&self, paths: &[&str]) -> Result<Vec<(String, String)>, String> {
        let mut args = vec!["-c", "%u:%g %a"];
        args.extend_from_slice(paths);
        let out = self
            .one_shot("0:0", "none", "stat", &args)
            .map_err(|e| e.0)?;
        if !out.success {
            return Err(out.stderr.trim().to_owned());
        }
        let rows: Vec<(String, String)> = out
            .stdout
            .lines()
            .filter_map(|l| l.split_once(' '))
            .map(|(owner, mode)| (owner.to_owned(), mode.trim().to_owned()))
            .collect();
        if rows.len() != paths.len() {
            return Err(format!(
                "stat printed {} rows for {} paths",
                rows.len(),
                paths.len()
            ));
        }
        Ok(rows)
    }

    /// The entries of a folder, from `ls -A` by a one-shot root container, sorted. `Err` with `ls`'s message.
    pub fn entries(&self, path: &str) -> Result<Vec<String>, String> {
        let out = self
            .one_shot("0:0", "none", "ls", &["-A", path])
            .map_err(|e| e.0)?;
        if !out.success {
            return Err(out.stderr.trim().to_owned());
        }
        let mut names: Vec<String> = out.stdout.lines().map(str::to_owned).collect();
        names.sort();
        Ok(names)
    }
}

impl Drop for Volume {
    fn drop(&mut self) {
        let _ = docker(&["volume", "rm", "-f", &self.name]);
    }
}

/// One process of `docker top`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Process {
    pub uid: String,
    pub gid: String,
    pub args: String,
}

/// An emulator container of the image, started detached. `docker rm -f` on drop.
pub struct ImageEmulator {
    pub name: String,
}

impl ImageEmulator {
    /// `docker run -d` of `aws-emulator:<tag>` as the checks start it, with `--network none`, no `--user` and no
    /// capability option unless `extra` adds one, the arguments `-p <VOLUME_PORT> -t off`. With a volume:
    /// `HOME=<VOLUME_HOME>` and the volume at `<VOLUME_FOLDER>`; without: no `HOME` and no mount (the image's own).
    pub fn start(
        ctx: &Ctx,
        tag: &str,
        volume: Option<&Volume>,
        extra: &[&str],
    ) -> Result<ImageEmulator, Env> {
        let name = format!("emuforge-it-img-{tag}-{}", ctx.run_id);
        let run_label = label(ctx);
        let home = format!("HOME={VOLUME_HOME}");
        let mount = volume.map(Volume::mount);
        let port = VOLUME_PORT.to_string();
        let image_tag = &ctx.image_tag;
        let mut args = vec![
            "run",
            "--pull",
            "never",
            "-d",
            "--name",
            &name,
            "--label",
            &run_label,
            "--memory",
            "2g",
            "--network",
            "none",
        ];
        if let Some(mount) = &mount {
            args.extend_from_slice(&["-e", &home, "-v", mount]);
        }
        args.extend_from_slice(extra);
        let start: &[&str] = &[
            &format!("aws-emulator:{image_tag}"),
            "-p",
            &port,
            "-t",
            "off",
        ];
        args.extend_from_slice(start);
        ctx.log(format!(
            "docker run -d {name}{}{}",
            if mount.is_some() {
                " on its volume"
            } else {
                " without a mount"
            },
            if extra.is_empty() {
                String::new()
            } else {
                format!(" with {}", extra.join(" "))
            }
        ));
        docker_ok(&args)?;
        Ok(ImageEmulator { name })
    }

    /// `running` or `exited exit=<code>` (or what `docker inspect` said).
    pub fn state(&self) -> String {
        match docker(&[
            "inspect",
            "-f",
            "{{.State.Status}} exit={{.State.ExitCode}}",
            &self.name,
        ]) {
            Ok(out) if out.success => out.stdout.trim().to_owned(),
            Ok(out) => out.stderr.trim().to_owned(),
            Err(e) => e.0,
        }
    }

    pub fn running(&self) -> bool {
        self.state().starts_with("running")
    }

    /// The exit code once the container has exited, waited for with `bound`; `None` when it still runs then.
    pub fn wait_exited(&self, bound: Duration) -> Option<i32> {
        wait_for(bound, || {
            let out = docker(&[
                "inspect",
                "-f",
                "{{.State.Status}} {{.State.ExitCode}}",
                &self.name,
            ])
            .ok()?;
            let text = out.stdout.trim().to_owned();
            let code = text.strip_prefix("exited ")?;
            code.parse::<i32>().ok()
        })
    }

    /// `docker logs`, standard output and standard error, as lines. Read to match fixed words; never logged.
    pub fn log_lines(&self) -> Result<Vec<String>, Env> {
        let out = docker(&["logs", &self.name])?;
        if !out.success {
            return Err(Env::new(format!(
                "docker logs {}: {}",
                self.name,
                out.stderr.trim()
            )));
        }
        Ok(out
            .stdout
            .lines()
            .chain(out.stderr.lines())
            .map(str::to_owned)
            .collect())
    }

    /// Whether any line of `docker logs` contains `needle`; for a failure message that tells the reason.
    pub fn logs_hold(&self, needle: &str) -> bool {
        self.log_lines()
            .map(|lines| lines.iter().any(|l| l.contains(needle)))
            .unwrap_or(false)
    }

    /// The container's processes, from `docker top <name> -eo uid,gid,pid,args` (Docker needs the `pid` column).
    pub fn processes(&self) -> Result<Vec<Process>, Env> {
        let text = docker_ok(&["top", &self.name, "-eo", "uid,gid,pid,args"])?;
        Ok(text
            .lines()
            .skip(1)
            .filter_map(|line| {
                let mut parts = line.split_whitespace();
                let uid = parts.next()?.to_owned();
                let gid = parts.next()?.to_owned();
                let _pid = parts.next()?;
                let args = parts.collect::<Vec<_>>().join(" ");
                Some(Process { uid, gid, args })
            })
            .collect())
    }

    /// `docker exec <name> <args>` with no `--user`.
    pub fn exec(&self, args: &[&str]) -> Result<Docker, Env> {
        let mut all = vec!["exec", self.name.as_str()];
        all.extend_from_slice(args);
        docker(&all)
    }

    /// `CapPrm` and `CapEff` of process 1, from `/proc/1/status` read by `docker exec`.
    pub fn caps_of_process_1(&self) -> Result<(String, String), Env> {
        let out = self.exec(&["cat", "/proc/1/status"])?;
        if !out.success {
            return Err(Env::new(format!(
                "docker exec {} cat /proc/1/status: {}",
                self.name,
                out.stderr.trim()
            )));
        }
        let field = |key: &str| {
            out.stdout
                .lines()
                .find_map(|l| l.strip_prefix(key))
                .map(|v| v.trim().to_owned())
                .unwrap_or_default()
        };
        Ok((field("CapPrm:"), field("CapEff:")))
    }

    /// `docker restart -t 10`.
    pub fn restart(&self, ctx: &Ctx) -> Result<Docker, Env> {
        ctx.log(format!("docker restart -t 10 {}", self.name));
        docker(&["restart", "-t", "10", &self.name])
    }

    /// `docker stop -t 10`.
    pub fn stop(&self, ctx: &Ctx) -> Result<Docker, Env> {
        ctx.log(format!("docker stop -t 10 {}", self.name));
        docker(&["stop", "-t", "10", &self.name])
    }

    /// The health call as `user`: a one-shot container of the image run as that `uid:gid` in this emulator's
    /// network namespace with `volume` mounted, `curl --cacert <port folder>/ca.pem` to
    /// `https://127.0.0.1:<VOLUME_PORT>/__admin/health`, repeated until it answers 200 within `READY_BOUND`.
    /// Returns the last status and body seen, or why there was none; it stops early once the container no
    /// longer runs.
    pub fn health_as(
        &self,
        ctx: &Ctx,
        volume: &Volume,
        user: &str,
    ) -> Result<(u16, String), String> {
        let network = format!("container:{}", self.name);
        let ca = port_file("ca.pem");
        let url = format!("https://127.0.0.1:{VOLUME_PORT}/__admin/health");
        let mut last = Err("no health call was made".to_owned());
        let answered = wait_for(READY_BOUND, || {
            if !self.running() {
                return Some(());
            }
            let out = match volume.one_shot(
                user,
                &network,
                "curl",
                &[
                    "-q",
                    "-sS",
                    "--noproxy",
                    "*",
                    "--max-time",
                    "5",
                    "--cacert",
                    &ca,
                    "-w",
                    "\n%{http_code}",
                    &url,
                ],
            ) {
                Ok(out) => out,
                Err(e) => {
                    last = Err(e.0);
                    return None;
                }
            };
            if !out.success {
                last = Err(format!("curl: {}", out.stderr.trim()));
                return None;
            }
            let (body, status) = out
                .stdout
                .rsplit_once('\n')
                .unwrap_or(("", out.stdout.as_str()));
            match status.trim().parse::<u16>() {
                Ok(status) => {
                    last = Ok((status, body.to_owned()));
                    (status == 200).then_some(())
                }
                Err(_) => {
                    last = Err("curl printed no status".to_owned());
                    None
                }
            }
        });
        if answered.is_none() {
            ctx.log(format!(
                "no 200 within {}s from {}",
                READY_BOUND.as_secs(),
                self.name
            ));
        }
        if !self.running() {
            let state = self.state();
            return Err(format!(
                "container {} is {state}; its logs hold `Permission denied (os error 13)`: {}",
                self.name,
                self.logs_hold("Permission denied (os error 13)")
            ));
        }
        last
    }
}

impl Drop for ImageEmulator {
    fn drop(&mut self) {
        let _ = docker(&["rm", "-f", &self.name]);
    }
}
