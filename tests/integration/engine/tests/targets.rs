//! `engine.targets-*` and `engine.checks-engines-keep-their-settings-in-the-run`: the engine's emulator targets
//! as a caller sees them through a real engine and real emulators (issue 485, test-criteria.md, Integration).
//!
//! Every engine here is started by the harness, so its settings folder is the check's own (`ctx.settings_dir`),
//! empty at the start; with no `targets.json` the engine holds `local` at the run's emulator.

#[path = "../support/mod.rs"]
mod support;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use support::*;

/// The bound for an engine whose target's emulator was restarted to pass its test again.
const RECOVERY_BOUND: Duration = Duration::from_secs(30);

fn send(ctx: &Ctx, request: Request, what: &str) -> Response {
    request
        .send(ctx, ctx.engine_port)
        .unwrap_or_else(|e| panic!("{what} got no answer: {e}"))
}

/// `POST /__emuforge/targets` with `{"name","endpoint"}`; asserts `201`.
fn add(ctx: &Ctx, name: &str, endpoint: &str) -> Response {
    let response = send(
        ctx,
        Request::new("POST", "/__emuforge/targets")
            .json(&serde_json::json!({ "name": name, "endpoint": endpoint })),
        &format!("add {name}"),
    );
    assert_eq!(
        response.status,
        201,
        "add {name} at {endpoint}: {}",
        response.text()
    );
    response
}

/// `POST /__emuforge/targets/<name>/use`; asserts `200` and that the answer names it active.
fn use_target(ctx: &Ctx, name: &str) -> Response {
    let response = send(
        ctx,
        Request::new("POST", &format!("/__emuforge/targets/{name}/use")),
        &format!("use {name}"),
    );
    assert_eq!(response.status, 200, "use {name}: {}", response.text());
    assert_eq!(
        response.json()["active"],
        name,
        "use {name}: {}",
        response.text()
    );
    response
}

fn list(ctx: &Ctx) -> Response {
    let response = send(ctx, Request::get("/__emuforge/targets"), "list");
    assert_eq!(response.status, 200, "list: {}", response.text());
    response
}

fn test_target(ctx: &Ctx, name: &str) -> Response {
    send(
        ctx,
        Request::new("POST", &format!("/__emuforge/targets/{name}/test")),
        &format!("test {name}"),
    )
}

fn endpoint_of(port: u16) -> String {
    format!("https://127.0.0.1:{port}")
}

/// The five checks of a passed test, in order: `files, connection, tls, health, credentials`, each `passed`.
fn assert_test_passed(response: &Response, name: &str) {
    assert_eq!(response.status, 200, "test {name}: {}", response.text());
    let body = response.json();
    assert_eq!(body["passed"], true, "test {name}: {body}");
    let checks: Vec<(String, String)> = body["checks"]
        .as_array()
        .unwrap_or_else(|| panic!("test {name}: no checks in {body}"))
        .iter()
        .map(|c| {
            (
                c["check"].as_str().unwrap_or_default().to_owned(),
                c["status"].as_str().unwrap_or_default().to_owned(),
            )
        })
        .collect();
    let expected: Vec<(String, String)> = ["files", "connection", "tls", "health", "credentials"]
        .iter()
        .map(|c| ((*c).to_owned(), "passed".to_owned()))
        .collect();
    assert_eq!(checks, expected, "test {name}: checks in {body}");
}

/// `HeadBucket` straight to an emulator: its status.
fn head_bucket(direct: &Direct, bucket: &str) -> u16 {
    direct
        .send(
            &format!("HeadBucket {bucket}"),
            &Call::s3("HEAD", &format!("/{bucket}")),
        )
        .unwrap_or_else(|Env(e)| panic!("{e}"))
        .status
}

/// Deletes a bucket straight on an emulator when it drops, whoever created it.
struct BucketCleanup<'a> {
    direct: Direct<'a>,
    name: String,
}

impl Drop for BucketCleanup<'_> {
    fn drop(&mut self) {
        let what = format!("cleanup DeleteBucket {}", self.name);
        match self
            .direct
            .send(&what, &Call::s3("DELETE", &format!("/{}", self.name)))
        {
            Ok(r) => self.direct.ctx.log(format!("{what}: {}", r.status)),
            Err(Env(e)) => self.direct.ctx.log(format!("{what}: {e}")),
        }
    }
}

/// `CreateBucket` through the engine, signed with the check's own made-up key; asserts `200`.
fn create_bucket_through_engine(ctx: &Ctx, bucket: &str) {
    let response = Call::s3("PUT", &format!("/{bucket}"))
        .send(ctx, &Endpoint::engine(ctx), &Key::check())
        .unwrap_or_else(|e| panic!("CreateBucket {bucket} through the engine got no answer: {e}"));
    assert_eq!(
        response.status,
        200,
        "CreateBucket {bucket} through the engine: {}",
        response.text()
    );
}

#[test]
fn targets_relay_follows_the_active_target() {
    check("engine.targets-relay-follows-the-active-target", |ctx| {
        let second = OwnEmulator::start(ctx)?;
        let run = Direct::new(ctx)?;
        let own = Direct {
            ctx,
            endpoint: Endpoint::emulator_on(ctx, second.port),
            key: Key::of_emulator(ctx, second.port)?,
        };
        let _engine = Engine::start(ctx, EngineCmd::new(ctx))?;

        add(ctx, "second", &endpoint_of(second.port));
        use_target(ctx, "second");
        let on_second = prefix(ctx, "tgt-second");
        let _cleanup_second = BucketCleanup {
            direct: own.clone(),
            name: on_second.clone(),
        };
        create_bucket_through_engine(ctx, &on_second);
        assert_eq!(
            head_bucket(&own, &on_second),
            200,
            "the bucket created while `second` was active is not in the second emulator"
        );
        assert_eq!(
            head_bucket(&run, &on_second),
            404,
            "the bucket created while `second` was active is in the run's emulator"
        );

        use_target(ctx, "local");
        let on_local = prefix(ctx, "tgt-local");
        let _cleanup_local = BucketCleanup {
            direct: run.clone(),
            name: on_local.clone(),
        };
        create_bucket_through_engine(ctx, &on_local);
        assert_eq!(
            head_bucket(&run, &on_local),
            200,
            "the bucket created while `local` was active is not in the run's emulator"
        );
        assert_eq!(
            head_bucket(&own, &on_local),
            404,
            "the bucket created while `local` was active is in the second emulator"
        );
        Ok(())
    });
}

#[test]
fn targets_health_follows_the_active_target_and_never_falls_back() {
    check(
        "engine.targets-health-follows-the-active-target-and-never-falls-back",
        |ctx| {
            // A loopback port where nothing listens and no emulator ever wrote its files.
            let gone_port = free_port_without_emulator(&ctx.home)?;
            let gone = endpoint_of(gone_port);
            let _engine = Engine::start(ctx, EngineCmd::new(ctx))?;
            add(ctx, "gone", &gone);
            use_target(ctx, "gone");

            let health = get_health(ctx, ctx.engine_port);
            assert_eq!(
                health.status,
                503,
                "health with `gone` active: {}",
                health.text()
            );
            let body = health.json();
            assert_eq!(body["target"], "gone", "health's target in {body}");
            assert_eq!(body["emulator"]["reachable"], false, "in {body}");
            assert_eq!(body["emulator"]["endpoint"], gone.as_str(), "in {body}");
            assert!(
                matches!(
                    body["emulator"]["reason"].as_str(),
                    Some("not_started" | "connection_refused")
                ),
                "health's reason in {body}"
            );

            let listed = Call::s3("GET", "/")
                .send(ctx, &Endpoint::engine(ctx), &Key::check())
                .unwrap_or_else(|e| panic!("ListBuckets through the engine got no answer: {e}"));
            assert_eq!(
                listed.status,
                503,
                "ListBuckets with `gone` active: {}",
                listed.text()
            );
            let text = listed.text();
            assert!(
                text.contains("EmulatorUnavailable") && text.contains(&gone),
                "ListBuckets with `gone` active names neither EmulatorUnavailable nor {gone}: {text}"
            );
            assert!(
                !text.contains(&endpoint_of(ctx.emulator_port)),
                "ListBuckets with `gone` active names the run's emulator: {text}"
            );

            use_target(ctx, "local");
            let back = get_health(ctx, ctx.engine_port);
            assert_reachable(&back, ctx.emulator_port);
            assert_eq!(
                back.json()["target"],
                "local",
                "health's target: {}",
                back.text()
            );
            let listed = Call::s3("GET", "/")
                .send(ctx, &Endpoint::engine(ctx), &Key::check())
                .unwrap_or_else(|e| panic!("ListBuckets through the engine got no answer: {e}"));
            assert_eq!(
                listed.status,
                200,
                "ListBuckets with `local` active again: {}",
                listed.text()
            );
            Ok(())
        },
    );
}

#[test]
fn targets_kept_across_restart() {
    check("engine.targets-kept-across-restart", |ctx| {
        let other_port = free_port_without_emulator(&ctx.home)?;
        let other = endpoint_of(other_port);
        let mut engine = Engine::start(ctx, EngineCmd::new(ctx))?;
        add(ctx, "other", &other);
        use_target(ctx, "other");
        engine.stop(ctx);

        let _engine = Engine::start(ctx, EngineCmd::new(ctx))?;
        let body = list(ctx).json();
        assert_eq!(
            body["active"], "other",
            "active after the restart in {body}"
        );
        let mut held: Vec<(String, String, bool)> = body["targets"]
            .as_array()
            .unwrap_or_else(|| panic!("no targets in {body}"))
            .iter()
            .map(|t| {
                (
                    t["name"].as_str().unwrap_or_default().to_owned(),
                    t["endpoint"].as_str().unwrap_or_default().to_owned(),
                    t["active"] == true,
                )
            })
            .collect();
        held.sort();
        assert_eq!(
            held,
            vec![
                ("local".to_owned(), endpoint_of(ctx.emulator_port), false),
                ("other".to_owned(), other.clone(), true),
            ],
            "targets after the restart in {body}"
        );
        let health = get_health(ctx, ctx.engine_port);
        let health_body = health.json();
        assert_eq!(
            health_body["target"], "other",
            "health after the restart: {health_body}"
        );
        assert_eq!(
            health_body["emulator"]["endpoint"],
            other.as_str(),
            "health after the restart: {health_body}"
        );
        Ok(())
    });
}

#[test]
fn targets_test_checks_a_running_emulator() {
    check("engine.targets-test-checks-a-running-emulator", |ctx| {
        match direct_health(&ctx.home, ctx.emulator_port) {
            Ok((200, body)) if body == b"ok" => {}
            other => {
                return Err(Env::new(format!(
                    "run's emulator does not answer 200 ok directly: {:?}",
                    other.map(|(s, _)| s)
                )));
            }
        }
        let _engine = Engine::start(ctx, EngineCmd::new(ctx))?;
        assert_test_passed(&test_target(ctx, "local"), "local");
        Ok(())
    });
}

#[test]
fn targets_test_follows_an_emulator_restart() {
    check("engine.targets-test-follows-an-emulator-restart", |ctx| {
        let emulator = OwnEmulator::start(ctx)?;
        let mut engine = Engine::start(ctx, EngineCmd::new(ctx))?;
        let pid = engine.pid;
        add(ctx, "own", &endpoint_of(emulator.port));
        use_target(ctx, "own");
        assert_test_passed(&test_target(ctx, "own"), "own");
        let credentials = emulator.dir.join("emulator_credentials");
        let before = sha256_file(&credentials)?;

        emulator.restart(ctx)?;
        let passed = wait_for(RECOVERY_BOUND, || {
            let response = test_target(ctx, "own");
            (response.status == 200 && response.json()["passed"] == true).then_some(response)
        });
        let passed = passed.unwrap_or_else(|| {
            panic!(
                "the test of `own` did not pass within {}s of docker restart",
                RECOVERY_BOUND.as_secs()
            )
        });
        // The new run's files are registered for redaction before anything else is logged.
        let _ = EmulatorFiles::read(&emulator.dir);
        assert_test_passed(&passed, "own");
        assert_ne!(
            before,
            sha256_file(&credentials)?,
            "emulator_credentials is unchanged after docker restart: no new keys"
        );
        assert!(
            engine.is_running(),
            "the engine exited during the emulator restart"
        );
        assert_eq!(engine.pid, pid, "the engine process changed");
        Ok(())
    });
}

#[test]
fn targets_hold_no_key() {
    check("engine.targets-hold-no-key", |ctx| {
        let files = EmulatorFiles::read(&emulator_dir(&ctx.home, ctx.emulator_port))
            .ok_or_else(|| Env::new("the run's emulator files cannot be read"))?;
        let secrets = [
            ("the key id", files.access_key_id.clone()),
            ("the secret", files.secret_access_key.clone()),
        ];
        let mut engine = Engine::start(ctx, EngineCmd::new(ctx))?;
        let run = endpoint_of(ctx.emulator_port);

        let mut answers: Vec<(String, Vec<u8>)> = Vec::new();
        let mut keep = |what: &str, response: Response| {
            answers.push((what.to_owned(), response.body));
        };
        keep("list", list(ctx));
        keep("add", add(ctx, "twin", &run));
        let info = send(ctx, Request::get("/__emuforge/targets/twin"), "info twin");
        assert_eq!(info.status, 200, "info twin: {}", info.text());
        keep("info", info);
        keep("use", use_target(ctx, "twin"));
        let tested = test_target(ctx, "twin");
        assert_test_passed(&tested, "twin");
        keep("test", tested);
        keep("use local", use_target(ctx, "local"));
        let removed = send(
            ctx,
            Request::new("DELETE", "/__emuforge/targets/twin"),
            "remove twin",
        );
        assert_eq!(removed.status, 204, "remove twin: {}", removed.text());
        keep("remove", removed);

        let file = ctx.settings_dir.join("targets.json");
        let settings = fs::read(&file)
            .unwrap_or_else(|e| panic!("the settings file {} cannot be read: {e}", file.display()));
        answers.push(("targets.json".to_owned(), settings));
        let output = engine.stop(ctx);
        answers.push((
            "the engine's log".to_owned(),
            format!("{}{}", output.stdout, output.stderr).into_bytes(),
        ));

        let mut found = Vec::new();
        for (what, bytes) in &answers {
            let text = String::from_utf8_lossy(bytes);
            for (name, secret) in &secrets {
                if text.contains(secret.as_str()) {
                    found.push(format!("{name} in {what}"));
                }
            }
        }
        assert_eq!(found, Vec::<String>::new(), "the emulator's key appears");
        Ok(())
    });
}

/// Every file under `dir`, by its path relative to `dir`, with its SHA-256; `None` when `dir` does not exist.
fn snapshot(dir: &Path) -> Result<Option<BTreeMap<PathBuf, String>>, Env> {
    if !dir.exists() {
        return Ok(None);
    }
    let mut files = BTreeMap::new();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(folder) = pending.pop() {
        let entries = fs::read_dir(&folder)
            .map_err(|e| Env::new(format!("cannot list {}: {e}", folder.display())))?;
        for entry in entries {
            let path = entry
                .map_err(|e| Env::new(format!("cannot list {}: {e}", folder.display())))?
                .path();
            if path.is_dir() {
                pending.push(path);
            } else {
                let relative = path.strip_prefix(dir).unwrap_or(&path).to_path_buf();
                files.insert(relative, sha256_file(&path)?);
            }
        }
    }
    Ok(Some(files))
}

#[test]
fn checks_engines_keep_their_settings_in_the_run() {
    check(
        "engine.checks-engines-keep-their-settings-in-the-run",
        |ctx| {
            let owners = [
                ctx.home.join(".config").join("emuforge"),
                ctx.home.join(".config").join("emuforge-compose"),
            ];
            let before: Vec<_> = owners
                .iter()
                .map(|dir| snapshot(dir))
                .collect::<Result<_, _>>()?;
            for (dir, state) in owners.iter().zip(&before) {
                ctx.log(format!(
                    "{} before: {}",
                    dir.display(),
                    state.as_ref().map_or("absent".to_owned(), |files| format!(
                        "{} files",
                        files.len()
                    ))
                ));
            }

            let _engine = Engine::start(ctx, EngineCmd::new(ctx))?;
            add(ctx, "kept", &endpoint_of(ctx.emulator_port));

            let file = ctx.settings_dir.join("targets.json");
            assert!(
                file.is_file(),
                "the add did not write {}, the check's own settings folder",
                file.display()
            );
            assert!(
                ctx.settings_dir
                    .components()
                    .any(|c| c.as_os_str() == "tmp")
                    && !ctx.settings_dir.starts_with(ctx.home.join(".config")),
                "the check's settings folder {} is not in the run's output",
                ctx.settings_dir.display()
            );
            for (dir, state) in owners.iter().zip(&before) {
                assert_eq!(
                    &snapshot(dir)?,
                    state,
                    "{} changed while a check's engine added a target",
                    dir.display()
                );
            }
            Ok(())
        },
    );
}
