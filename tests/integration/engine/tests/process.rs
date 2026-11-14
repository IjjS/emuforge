//! How the engine process starts and refuses to start (test-criteria.md, issue 1).

#[path = "../support/mod.rs"]
mod support;

use std::net::{Ipv4Addr, TcpListener};
use std::time::Duration;

use support::*;

#[test]
fn start_refuses_port_in_use() {
    check("engine.start-refuses-port-in-use", |ctx| {
        let port = ctx.engine_port;
        let held = TcpListener::bind((Ipv4Addr::LOCALHOST, port))
            .map_err(|e| Env::new(format!("cannot hold 127.0.0.1:{port}: {e}")))?;
        ctx.log(format!("check holds 127.0.0.1:{port}"));

        let mut refused = EngineCmd::new(ctx).spawn(ctx);
        let (status, _) = refused.wait_exit(Duration::from_secs(1));
        let output = refused.stop(ctx);
        let status = status
            .unwrap_or_else(|| panic!("the engine still runs 1 s after start on a port in use"));
        assert!(
            !status.success(),
            "the engine exited with {status} on a port in use; expected non-zero"
        );
        let address = format!("127.0.0.1:{port}");
        assert!(
            output.stderr.contains(&address),
            "stderr does not name {address}: {}",
            output.stderr.trim()
        );
        assert!(
            output.stderr.contains("--port"),
            "stderr does not name --port: {}",
            output.stderr.trim()
        );

        drop(held);
        ctx.log(format!("check released 127.0.0.1:{port}"));
        let mut engine = Engine::start(ctx, EngineCmd::new(ctx))?;
        let answer = get_health(ctx, port);
        ctx.log(format!("health answered {}", answer.status));
        assert!(
            engine.is_running(),
            "the engine exited after answering health"
        );
        Ok(())
    });
}

/// One named start that the engine must refuse.
struct Refusal {
    case: &'static str,
    cmd: EngineCmd,
    /// `Some(2)` for a usage error, `None` for any non-zero code.
    code: Option<i32>,
    /// stderr must contain at least one of each group.
    names: Vec<Vec<String>>,
}

#[test]
fn start_refuses_bad_configuration() {
    check("engine.start-refuses-bad-configuration", |ctx| {
        let port = ctx.engine_port.to_string();
        let strings = |names: &[&str]| names.iter().map(|n| (*n).to_owned()).collect::<Vec<_>>();
        let cases = vec![
            Refusal {
                case: "HOME unset",
                cmd: EngineCmd::new(ctx).env_remove("HOME"),
                code: None,
                names: vec![strings(&["HOME"])],
            },
            Refusal {
                case: "HOME empty",
                cmd: EngineCmd::new(ctx).env("HOME", ""),
                code: None,
                names: vec![strings(&["HOME"])],
            },
            Refusal {
                case: "EMUFORGE_ENGINE_PORT=abc",
                cmd: EngineCmd::new(ctx).env("EMUFORGE_ENGINE_PORT", "abc"),
                code: Some(2),
                names: vec![strings(&["EMUFORGE_ENGINE_PORT", "--port"])],
            },
            Refusal {
                case: "EMULATOR_PORT=0",
                cmd: EngineCmd::new(ctx).env("EMULATOR_PORT", "0"),
                code: Some(2),
                names: vec![strings(&["EMULATOR_PORT", "--emulator-port"])],
            },
            Refusal {
                case: "--port equal to --emulator-port",
                cmd: EngineCmd::new(ctx)
                    .arg("--port")
                    .arg(port.clone())
                    .arg("--emulator-port")
                    .arg(port.clone()),
                code: Some(2),
                names: vec![strings(&["--port"]), strings(&["--emulator-port"])],
            },
        ];

        let mut failures = Vec::new();
        for Refusal {
            case,
            cmd,
            code,
            names,
        } in cases
        {
            ensure_port_free(ctx.engine_port)?;
            let mut engine = cmd.spawn(ctx);
            let (status, listened) = engine.wait_exit(Duration::from_secs(5));
            let output = engine.stop(ctx);
            let Some(status) = status else {
                failures.push(format!("{case}: still running 5 s after start"));
                continue;
            };
            match code {
                Some(expected) if status.code() != Some(expected) => {
                    failures.push(format!(
                        "{case}: exited with {status}, expected code {expected}"
                    ));
                }
                None if status.success() => {
                    failures.push(format!("{case}: exited with {status}, expected non-zero"))
                }
                _ => {}
            }
            for group in &names {
                if !group.iter().any(|n| output.stderr.contains(n.as_str())) {
                    failures.push(format!(
                        "{case}: stderr names none of {group:?}: {}",
                        output.stderr.trim()
                    ));
                }
            }
            if listened {
                failures.push(format!(
                    "{case}: something listened on 127.0.0.1:{} before the engine exited",
                    ctx.engine_port
                ));
            }
            ctx.log(format!("case {case}: exited with {status}"));
        }

        // The paired success: HOME set and different ports.
        let mut engine = Engine::start(ctx, EngineCmd::new(ctx))?;
        if !engine.is_running() {
            failures
                .push("HOME set and different ports: the engine did not keep running".to_owned());
        }

        assert!(failures.is_empty(), "{}", failures.join("\n"));
        Ok(())
    });
}
