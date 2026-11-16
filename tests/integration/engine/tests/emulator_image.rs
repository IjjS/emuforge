//! `engine.emulator-image-*`, `engine.readme-run-the-emulator-creates-the-folder-first` and
//! `engine.workflow-builds-the-emulator-image-as-the-repository-ships-it`: the image `aws-emulator` writes files
//! the owner of the mounted folder can read on a filesystem that shows real owners, as Docker Engine on Linux does,
//! and the README and the workflow start it that way (test-criteria.md, issue 55).
//!
//! The image cases run on a Docker volume (`support/volume.rs`); `U:G` is `4242:4343`, "another user" `5252:5353`.
//! No file of an emulator is opened for its content, and nothing of one is printed, logged or copied out.

#[path = "../support/mod.rs"]
mod support;

use std::fs;
use std::panic::{self, AssertUnwindSafe};
use std::path::PathBuf;
use std::time::Duration;

use support::volume::*;
use support::*;

const OWNER: &str = "4242:4343";
const ANOTHER_USER: &str = "5252:5353";

/// The criteria's bound for a container that must exit by itself.
const EXIT_BOUND: Duration = Duration::from_secs(10);

/// The checkout's root: this package is `tests/integration/engine`.
fn checkout() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn read_checkout_file(relative: &str) -> Result<String, Env> {
    let path = checkout().join(relative);
    fs::read_to_string(&path).map_err(|e| Env::new(format!("cannot read {}: {e}", path.display())))
}

/// The cases of one check. Every case runs, even after one has failed, so the log records each case's outcome
/// (the cases the criteria mark "holds on `main`" among them); `finish` then fails the check with every failed
/// case, or gives the first environment error.
#[derive(Default)]
struct Cases {
    failed: Vec<String>,
    error: Option<Env>,
}

impl Cases {
    fn run(&mut self, ctx: &mut Ctx, name: &str, case: impl FnOnce(&mut Ctx) -> Result<(), Env>) {
        ctx.log(format!("case {name}"));
        match panic::catch_unwind(AssertUnwindSafe(|| case(ctx))) {
            Ok(Ok(())) => ctx.log(format!("case {name}: passed")),
            Ok(Err(e)) => {
                ctx.log(format!("case {name}: error {}", e.0));
                self.error.get_or_insert(e);
            }
            Err(payload) => {
                let text = payload
                    .downcast_ref::<String>()
                    .cloned()
                    .or_else(|| payload.downcast_ref::<&str>().map(|s| (*s).to_owned()))
                    .unwrap_or_else(|| "(no message)".to_owned());
                ctx.log(format!("case {name}: failed: {text}"));
                self.failed.push(format!("case {name}: {text}"));
            }
        }
    }

    fn finish(self) -> Result<(), Env> {
        if let Some(error) = self.error {
            return Err(error);
        }
        if !self.failed.is_empty() {
            panic!("{}", self.failed.join("; "));
        }
        Ok(())
    }
}

/// The health call as `user` must answer 200 with the body `ok`.
fn assert_health_ok(ctx: &Ctx, emulator: &ImageEmulator, volume: &Volume, user: &str) {
    match emulator.health_as(ctx, volume, user) {
        Ok((200, body)) if body == "ok" => ctx.log(format!("health as {user}: 200 ok")),
        other => panic!("health call as {user}: expected 200 ok, got {other:?}"),
    }
}

/// The port folder and its four files: the folder `owner`, mode `700`; each file `owner`, mode `600`.
fn assert_port_folder(volume: &Volume, owner: &str) {
    let folder = port_folder();
    let files: Vec<String> = EMULATOR_FILES.iter().map(|f| port_file(f)).collect();
    let mut paths = vec![folder.as_str()];
    paths.extend(files.iter().map(String::as_str));
    let rows = volume
        .stat(&paths)
        .unwrap_or_else(|e| panic!("stat of the port folder and its files failed: {e}"));
    assert_eq!(
        rows[0],
        (owner.to_owned(), "700".to_owned()),
        "owner and mode of the port folder {folder}"
    );
    for (file, row) in EMULATOR_FILES.iter().zip(&rows[1..]) {
        assert_eq!(
            row,
            &(owner.to_owned(), "600".to_owned()),
            "owner and mode of {file} in the port folder"
        );
    }
}

/// Exactly one process, its command starting with `aws-emulator`, with this uid and gid.
fn assert_one_emulator_process(emulator: &ImageEmulator, uid: &str, gid: &str) -> Result<(), Env> {
    let processes = emulator.processes()?;
    assert_eq!(
        processes.len(),
        1,
        "the container runs exactly one process; it runs {processes:?}"
    );
    let process = &processes[0];
    assert!(
        process.args.starts_with("aws-emulator"),
        "the one process is the emulator; its command is {:?}",
        process.args
    );
    assert_eq!(
        (process.uid.as_str(), process.gid.as_str()),
        (uid, gid),
        "uid and gid of the emulator's process"
    );
    Ok(())
}

/// `CapPrm` and `CapEff` of process 1 are zero.
fn assert_no_capabilities(emulator: &ImageEmulator) -> Result<(), Env> {
    let (prm, eff) = emulator.caps_of_process_1()?;
    let zero = |v: &str| !v.is_empty() && v.chars().all(|c| c == '0');
    assert!(zero(&prm), "CapPrm of process 1 is zero; it is {prm:?}");
    assert!(zero(&eff), "CapEff of process 1 is zero; it is {eff:?}");
    Ok(())
}

/// A one-shot command as `ANOTHER_USER` must fail with a permission error.
fn assert_refused(out: &Docker, what: &str) {
    assert!(
        !out.success,
        "{what} as {ANOTHER_USER} succeeded; it must fail with a permission error"
    );
    assert!(
        out.stderr.contains("Permission denied"),
        "{what} as {ANOTHER_USER} failed, but not with a permission error: {}",
        out.stderr.trim()
    );
}

#[test]
fn emulator_image_gives_its_files_to_the_folders_owner() {
    check(
        "engine.emulator-image-gives-its-files-to-the-folders-owner",
        |ctx| {
            let mut cases = Cases::default();
            // A folder of 4242:4343, mode 0755, and the image started on it as the checks start it.
            cases.run(ctx, "folder 4242:4343 mode 0755", |ctx| {
                let volume = Volume::create(ctx, "owner", OWNER, "0755")?;
                let emulator = ImageEmulator::start(ctx, "owner", Some(&volume), &[])?;

                assert_health_ok(ctx, &emulator, &volume, OWNER);
                assert!(
                    emulator.running(),
                    "the container is still running after the health call; it is {}",
                    emulator.state()
                );

                assert_port_folder(&volume, OWNER);
                let entries = volume
                    .entries(&port_folder())
                    .unwrap_or_else(|e| panic!("ls -A of the port folder failed: {e}"));
                assert_eq!(entries, EMULATOR_FILES, "the entries of the port folder");
                ctx.log(
                    "port folder 4242:4343 700 holds exactly the four files, each 4242:4343 600",
                );

                let ca = port_file("ca.pem");
                let open = volume.one_shot(
                    ANOTHER_USER,
                    "none",
                    "sh",
                    &["-c", r#": < "$1""#, "sh", &ca],
                )?;
                assert_refused(&open, "opening ca.pem for reading");
                let list = volume.one_shot(ANOTHER_USER, "none", "ls", &["-A", &port_folder()])?;
                assert_refused(&list, "listing the port folder");
                ctx.log("5252:5353 can neither open ca.pem nor list the port folder");

                assert_one_emulator_process(&emulator, "4242", "4343")?;
                assert_no_capabilities(&emulator)?;
                ctx.log("one process aws-emulator, uid 4242 gid 4343, CapPrm and CapEff zero");
                drop(emulator);
                Ok(())
            });

            // A folder of 4242:4343, mode 0755, the image started with --user 4242:4343.

            cases.run(ctx, "folder 4242:4343 mode 0755, --user 4242:4343", |ctx| {
                let volume = Volume::create(ctx, "user", OWNER, "0755")?;
                let emulator =
                    ImageEmulator::start(ctx, "user", Some(&volume), &["--user", OWNER])?;
                assert_health_ok(ctx, &emulator, &volume, OWNER);
                assert_one_emulator_process(&emulator, "4242", "4343")?;
                assert_port_folder(&volume, OWNER);
                ctx.log(
                    "with --user 4242:4343: health 200 ok, uid 4242 gid 4343, files 4242:4343 600",
                );
                drop(emulator);
                Ok(())
            });

            // A folder of 1000:1000, mode 0755, and the image started on it as the checks start it.

            cases.run(ctx, "folder 1000:1000 mode 0755", |ctx| {
                let volume = Volume::create(ctx, "uid1000", "1000:1000", "0755")?;
                let emulator = ImageEmulator::start(ctx, "uid1000", Some(&volume), &[])?;
                assert_health_ok(ctx, &emulator, &volume, "1000:1000");
                assert_port_folder(&volume, "1000:1000");
                ctx.log("folder 1000:1000: port folder and files 1000:1000");
                drop(emulator);
                Ok(())
            });
            cases.finish()
        },
    );
}

#[test]
fn emulator_image_stops_and_restarts_as_the_folders_owner() {
    check(
        "engine.emulator-image-stops-and-restarts-as-the-folders-owner",
        |ctx| {
            let volume = Volume::create(ctx, "restart", OWNER, "0755")?;
            let emulator = ImageEmulator::start(ctx, "restart", Some(&volume), &[])?;
            assert_health_ok(ctx, &emulator, &volume, OWNER);

            let restarted = emulator.restart(ctx)?;
            assert!(
                restarted.success,
                "docker restart -t 10 failed: {}",
                restarted.stderr.trim()
            );
            // Each health call reads the ca.pem present at that moment, so a 200 trusts the one written after the
            // restart.
            assert_health_ok(ctx, &emulator, &volume, OWNER);
            assert_port_folder(&volume, OWNER);
            ctx.log("after docker restart: health 200 ok, port folder 4242:4343 700, files 4242:4343 600");

            let stopped = emulator.stop(ctx)?;
            assert!(
                stopped.success,
                "docker stop -t 10 failed: {}",
                stopped.stderr.trim()
            );
            let state = emulator.state();
            assert_eq!(
                state, "exited exit=0",
                "after docker stop the emulator ended on SIGTERM with exit code 0"
            );
            let entries = volume.entries(&port_folder()).unwrap_or_else(|e| {
                panic!("ls -A of the port folder after docker stop failed: {e}")
            });
            assert!(
                entries.is_empty(),
                "after docker stop the port folder has no entry; it holds {entries:?}"
            );
            ctx.log("docker stop: exit 0, port folder empty");
            drop(emulator);
            Ok(())
        },
    );
}

#[test]
fn emulator_image_never_runs_as_root() {
    check("engine.emulator-image-never-runs-as-root", |ctx| {
        let mut cases = Cases::default();
        // A folder of 0:0, mode 0755: what Docker Engine makes when the folder is missing.
        cases.run(ctx, "folder 0:0 mode 0755", |ctx| {
            let volume = Volume::create(ctx, "root755", "0:0", "0755")?;
            let emulator = ImageEmulator::start(ctx, "root755", Some(&volume), &[])?;
            let code = emulator.wait_exited(EXIT_BOUND).unwrap_or_else(|| {
                panic!(
                    "the container is still running {}s after its start on a folder of root",
                    EXIT_BOUND.as_secs()
                )
            });
            let lines = emulator.log_lines()?;
            let os_error = lines
                .iter()
                .any(|l| l.contains("Permission denied (os error 13)"));
            let message = lines
                .iter()
                .filter(|l| {
                    l.contains(VOLUME_FOLDER)
                        && l.contains("belongs to root")
                        && l.contains("mkdir -p ~/.aws/emulator")
                        && l.contains("chown")
                })
                .count();
            ctx.log(format!(
                "exited {code}; lines with the refusal message: {message}; a line with `Permission denied (os \
                 error 13)`: {os_error}"
            ));
            assert_eq!(code, 1, "exit code of the container on a folder of root");
            assert_eq!(
                message, 1,
                "docker logs holds one line naming {VOLUME_FOLDER}, `belongs to root`, `mkdir -p ~/.aws/emulator` \
                 and `chown`"
            );
            assert!(
                !os_error,
                "docker logs holds `Permission denied (os error 13)`: the emulator was started on the folder"
            );
            let entries = volume
                .entries(VOLUME_FOLDER)
                .unwrap_or_else(|e| panic!("ls -A of the folder failed: {e}"));
            assert!(
                entries.is_empty(),
                "nothing is written into a refused folder; it holds {} entries",
                entries.len()
            );
            drop(emulator);
            Ok(())
        });

        // A folder of 0:0, mode 0777: uid 1000 may write it, so the emulator runs as 1000:0.

        cases.run(ctx, "folder 0:0 mode 0777", |ctx| {
            let volume = Volume::create(ctx, "root777", "0:0", "0777")?;
            let emulator = ImageEmulator::start(ctx, "root777", Some(&volume), &[])?;
            assert_health_ok(ctx, &emulator, &volume, "0:0");
            assert_one_emulator_process(&emulator, "1000", "0")?;
            let folder = port_folder();
            let rows = volume
                .stat(&[folder.as_str()])
                .unwrap_or_else(|e| panic!("stat of the port folder failed: {e}"));
            assert_eq!(
                rows[0],
                ("1000:0".to_owned(), "700".to_owned()),
                "owner and mode of the port folder in a folder of root, mode 0777"
            );
            assert_no_capabilities(&emulator)?;
            ctx.log("folder 0:0 0777: health 200 ok, uid 1000 gid 0, port folder 1000:0 700, no capability");
            drop(emulator);
            Ok(())
        });

        // No folder mounted and no HOME given: the image's own HOME.

        cases.run(ctx, "no folder, no HOME", |ctx| {
            let emulator = ImageEmulator::start(ctx, "nohome", None, &[])?;
            let port_dir = format!("/home/emulator/.aws/emulator/{VOLUME_PORT}");
            let ca = format!("{port_dir}/ca.pem");
            let written = wait_for(READY_BOUND, || {
                emulator
                    .exec(&["test", "-e", &ca])
                    .ok()
                    .filter(|out| out.success)
                    .map(|_| ())
            });
            assert!(
                written.is_some(),
                "{ca} does not exist within {}s; the container is {}",
                READY_BOUND.as_secs(),
                emulator.state()
            );
            assert_one_emulator_process(&emulator, "1000", "0")?;
            let stat = emulator.exec(&["stat", "-c", "%u:%g %a", &port_dir])?;
            assert!(
                stat.success,
                "docker exec stat failed: {}",
                stat.stderr.trim()
            );
            assert_eq!(
                stat.stdout.trim(),
                "1000:0 700",
                "owner and mode of {port_dir} without a mount"
            );
            ctx.log("no folder mounted: uid 1000 gid 0, port folder 1000:0 700");
            drop(emulator);
            Ok(())
        });
        cases.finish()
    });
}

/// The part of `README.md` under `## Run the emulator`, up to the next heading of the same level.
fn run_the_emulator_part(readme: &str) -> Option<Vec<&str>> {
    let mut lines = readme.lines();
    lines.find(|l| l.trim_end() == "## Run the emulator")?;
    Some(lines.take_while(|l| !l.starts_with("## ")).collect())
}

/// Splits `text` into sentences at `.`, `!` or `?` followed by white space or the end.
fn sentences(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = text.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        current.push(*c);
        let end =
            matches!(c, '.' | '!' | '?') && chars.get(i + 1).is_none_or(|n| n.is_whitespace());
        if end {
            out.push(current.trim().to_owned());
            current.clear();
        }
    }
    if !current.trim().is_empty() {
        out.push(current.trim().to_owned());
    }
    out
}

#[test]
fn readme_run_the_emulator_creates_the_folder_first() {
    check(
        "engine.readme-run-the-emulator-creates-the-folder-first",
        |ctx| {
            let readme = read_checkout_file("README.md")?;
            let part = run_the_emulator_part(&readme)
                .unwrap_or_else(|| panic!("README.md has no heading `## Run the emulator`"));

            let mut in_code = false;
            let mut commands = Vec::new();
            let mut prose = Vec::new();
            for line in &part {
                if line.trim_start().starts_with("```") {
                    in_code = !in_code;
                    continue;
                }
                if in_code {
                    // A command is the line without its trailing comment.
                    let command = match line.find(" #") {
                        Some(at) => &line[..at],
                        None => line,
                    };
                    let command = command.trim();
                    if !command.is_empty() && !command.starts_with('#') {
                        commands.push(command.to_owned());
                    }
                } else {
                    prose.push(*line);
                }
            }
            ctx.log(format!("commands of `Run the emulator`: {commands:?}"));

            assert_eq!(
                commands.first().map(String::as_str),
                Some("mkdir -p ~/.aws/emulator"),
                "the first command of `Run the emulator`"
            );
            let compose = "docker compose -f infra/aws-emulator/docker-compose.yml up -d --build";
            let at = commands.iter().position(|c| c == compose);
            assert!(
                at.is_some_and(|at| at > 0),
                "`{compose}` comes after `mkdir -p ~/.aws/emulator` in `Run the emulator`"
            );

            let text = prose.join(" ");
            let sentences = sentences(&text);
            assert!(
                sentences.iter().any(|s| {
                    s.contains("Docker Engine on Linux")
                        && s.contains("owner")
                        && s.contains("~/.aws/emulator")
                }),
                "one sentence of `Run the emulator` holds `Docker Engine on Linux`, `owner` and `~/.aws/emulator`; \
             its sentences are {sentences:?}"
            );
            assert!(
                sentences
                    .iter()
                    .any(|s| s.contains("root") && s.contains("refuses")),
                "one sentence of `Run the emulator` holds `root` and `refuses`; its sentences are {sentences:?}"
            );
            Ok(())
        },
    );
}

/// The `run` lines of the step named `emulator image`: the lines of its `run: |` block, trimmed, without empty
/// lines and comments.
fn emulator_image_run_lines(workflow: &str) -> Option<Vec<String>> {
    let lines: Vec<&str> = workflow.lines().collect();
    let start = lines.iter().position(|l| {
        let t = l.trim();
        t == "- name: emulator image" || t == "name: emulator image"
    })?;
    let indent_of = |l: &str| l.len() - l.trim_start().len();
    let step_indent = indent_of(lines[start]);
    let mut out = Vec::new();
    let mut i = start + 1;
    while i < lines.len() {
        let line = lines[i];
        let indent = indent_of(line);
        let t = line.trim();
        if !t.is_empty() && indent <= step_indent {
            break; // the next step, or the end of the steps
        }
        if let Some(value) = t.strip_prefix("run:") {
            let value = value.trim();
            if value != "|" && !value.is_empty() {
                out.push(value.to_owned());
                return Some(out);
            }
            let run_indent = indent;
            i += 1;
            while i < lines.len() {
                let line = lines[i];
                let t = line.trim();
                if !t.is_empty() && indent_of(line) <= run_indent {
                    break;
                }
                if !t.is_empty() && !t.starts_with('#') {
                    out.push(t.to_owned());
                }
                i += 1;
            }
            return Some(out);
        }
        i += 1;
    }
    Some(out)
}

#[test]
fn workflow_builds_the_emulator_image_as_the_repository_ships_it() {
    check(
        "engine.workflow-builds-the-emulator-image-as-the-repository-ships-it",
        |ctx| {
            let workflow = read_checkout_file(".github/workflows/main.yml")?;
            let run = emulator_image_run_lines(&workflow)
                .unwrap_or_else(|| panic!("main.yml has no step named `emulator image`"));
            ctx.log(format!("run lines of `emulator image`: {run:?}"));

            assert_eq!(
                run.len(),
                3,
                "the step `emulator image` runs exactly three commands; it runs {run:?}"
            );
            assert_eq!(
                run[0], r#"mkdir -p "$HOME/.aws/emulator""#,
                "first command of `emulator image`"
            );
            let echo = &run[1];
            assert!(
                echo.split_whitespace().next() == Some("echo")
                    && echo.contains("$(id -u)")
                    && !echo.contains('|')
                    && !echo.contains('>')
                    && !echo.contains('<'),
                "second command of `emulator image` is an `echo` that holds `$(id -u)`, with no pipe and no \
             redirection; it is {echo:?}"
            );
            assert_eq!(
                run[2], "docker compose -f infra/aws-emulator/docker-compose.yml build",
                "third command of `emulator image`"
            );

            let forbidden = [
                "docker build",
                "docker buildx",
                "docker tag",
                "docker image tag",
                "USER",
            ];
            for (n, line) in workflow.lines().enumerate() {
                let code = line.trim_start();
                if code.starts_with('#') {
                    continue;
                }
                let code = match code.find(" #") {
                    Some(at) => &code[..at],
                    None => code,
                };
                for word in forbidden {
                    assert!(
                        !code.contains(word),
                        "main.yml line {} holds `{word}` outside a comment: {line:?}",
                        n + 1
                    );
                }
            }
            for (n, line) in workflow.lines().enumerate() {
                assert!(
                    !line.contains("#55"),
                    "main.yml line {} holds `#55`: {line:?}",
                    n + 1
                );
            }
            Ok(())
        },
    );
}
