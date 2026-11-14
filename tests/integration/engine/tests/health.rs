//! `engine.health-*`: what `GET /__emuforge/health` reports for each state of the emulator
//! (test-criteria.md, issue 1).

#[path = "../support/mod.rs"]
mod support;

use std::io::ErrorKind;
use std::net::{Ipv4Addr, SocketAddr};
use std::time::Duration;

use support::*;

/// The criteria's bound for an engine that recovers after `docker restart`.
const RECOVERY_BOUND: Duration = Duration::from_secs(30);

/// Whether `line` names the number `n` as a whole number, not as part of a longer one.
fn names_number(line: &str, n: u16) -> bool {
    let n = n.to_string();
    line.match_indices(&n).any(|(at, _)| {
        let before = line[..at].chars().next_back();
        let after = line[at + n.len()..].chars().next();
        !before.is_some_and(|c| c.is_ascii_digit()) && !after.is_some_and(|c| c.is_ascii_digit())
    })
}

#[test]
fn health_reports_emulator_reachable() {
    check("engine.health-reports-emulator-reachable", |ctx| {
        // The run's emulator answers its own health route (checked directly, not through the engine).
        match direct_health(&ctx.home, ctx.emulator_port) {
            Ok((200, body)) if body == b"ok" => ctx.log("run's emulator answers 200 ok directly"),
            other => {
                let shown = other.map(|(s, b)| format!("{s} {}", String::from_utf8_lossy(&b)));
                return Err(Env::new(format!(
                    "run's emulator does not answer 200 ok directly: {shown:?}"
                )));
            }
        }

        let mut engine = Engine::start(
            ctx,
            EngineCmd::new(ctx).env("EMULATOR_PORT", ctx.emulator_port.to_string()),
        )?;

        let first = get_health(ctx, ctx.engine_port);
        assert_reachable(&first, ctx.emulator_port);

        let head = Request::head("/__emuforge/health")
            .send(ctx, ctx.engine_port)
            .unwrap_or_else(|e| panic!("HEAD /__emuforge/health got no answer: {e}"));
        assert_eq!(head.status, 200, "HEAD /__emuforge/health status");
        assert!(
            head.body.is_empty(),
            "HEAD /__emuforge/health carried a body of {} bytes",
            head.body.len()
        );

        let second = get_health(ctx, ctx.engine_port);
        assert_reachable(&second, ctx.emulator_port);

        let listen = format!("127.0.0.1:{}", ctx.engine_port);
        let start_line = wait_for(Duration::from_secs(2), || {
            engine
                .stderr_now()
                .lines()
                .find(|l| {
                    l.contains(&listen) && names_number(&l.replace(&listen, ""), ctx.emulator_port)
                })
                .map(str::to_owned)
        });
        assert!(
            start_line.is_some(),
            "no stderr line names both {listen} and the emulator port {}; stderr: {}",
            ctx.emulator_port,
            engine.stderr_now()
        );
        engine.stop(ctx);
        drop(engine);

        // The flag wins over the variable: EMUFORGE_ENGINE_PORT=Q, --port <engine port>.
        let q = free_port()?;
        let _engine = Engine::start(
            ctx,
            EngineCmd::new(ctx)
                .env("EMUFORGE_ENGINE_PORT", q.to_string())
                .arg("--port")
                .arg(ctx.engine_port.to_string()),
        )?;
        let on_flag = get_health(ctx, ctx.engine_port);
        assert_reachable(&on_flag, ctx.emulator_port);
        let on_variable = connect(ctx, SocketAddr::from((Ipv4Addr::LOCALHOST, q)));
        match on_variable {
            Err(e) if e.kind() == ErrorKind::ConnectionRefused => {
                ctx.log(format!("127.0.0.1:{q} refused"))
            }
            Err(e) => {
                panic!("connect to 127.0.0.1:{q} (EMUFORGE_ENGINE_PORT): expected refused, got {e}")
            }
            Ok(_) => panic!(
                "connect to 127.0.0.1:{q} (EMUFORGE_ENGINE_PORT) was accepted; --port must win"
            ),
        }
        Ok(())
    });
}

#[test]
fn health_reports_emulator_not_started() {
    check("engine.health-reports-emulator-not-started", |ctx| {
        let p = free_port_without_emulator(&ctx.home)?;
        let mut engine = Engine::start(
            ctx,
            EngineCmd::new(ctx)
                .env("EMULATOR_PORT", ctx.emulator_port.to_string())
                .arg("--emulator-port")
                .arg(p.to_string()),
        )?;

        let first = get_health(ctx, ctx.engine_port);
        assert_answered_in_time(&first);
        assert_unreachable(&first, "not_started", p);

        let again = get_health(ctx, ctx.engine_port);
        assert_unreachable(&again, "not_started", p);
        assert!(
            engine.is_running(),
            "the engine exited after answering not_started"
        );
        Ok(())
    });
}

#[test]
fn health_reports_emulator_stopped() {
    check("engine.health-reports-emulator-stopped", |ctx| {
        let emulator = OwnEmulator::start(ctx)?;
        let mut engine = Engine::start(
            ctx,
            EngineCmd::new(ctx).env("EMULATOR_PORT", emulator.port.to_string()),
        )?;
        assert_reachable(&get_health(ctx, ctx.engine_port), emulator.port);

        emulator.stop(ctx)?;
        let after = get_health(ctx, ctx.engine_port);
        assert_answered_in_time(&after);
        assert_unreachable(&after, "not_started", emulator.port);
        assert!(
            engine.is_running(),
            "the engine exited after the emulator stopped"
        );
        Ok(())
    });
}

#[test]
fn health_reports_emulator_killed() {
    check("engine.health-reports-emulator-killed", |ctx| {
        let emulator = OwnEmulator::start(ctx)?;
        let mut engine = Engine::start(
            ctx,
            EngineCmd::new(ctx).env("EMULATOR_PORT", emulator.port.to_string()),
        )?;
        assert_reachable(&get_health(ctx, ctx.engine_port), emulator.port);

        emulator.kill(ctx)?;
        let files_remain = emulator.dir.join("ca.pem").is_file()
            && emulator.dir.join("emulator_credentials").is_file();
        if !files_remain {
            return Err(Env::new(
                "docker kill did not leave the emulator's files behind",
            ));
        }
        let after = get_health(ctx, ctx.engine_port);
        assert_answered_in_time(&after);
        assert_unreachable(&after, "connection_refused", emulator.port);
        assert!(
            engine.is_running(),
            "the engine exited after the emulator was killed"
        );
        Ok(())
    });
}

#[test]
fn health_survives_emulator_restart() {
    check("engine.health-survives-emulator-restart", |ctx| {
        let emulator = OwnEmulator::start(ctx)?;
        let mut engine = Engine::start(
            ctx,
            EngineCmd::new(ctx).env("EMULATOR_PORT", emulator.port.to_string()),
        )?;
        let pid = engine.pid;
        assert_reachable(&get_health(ctx, ctx.engine_port), emulator.port);
        let ca = emulator.dir.join("ca.pem");
        let credentials = emulator.dir.join("emulator_credentials");
        let before = (sha256_file(&ca)?, sha256_file(&credentials)?);

        emulator.restart(ctx)?;
        // Each request is answered within 5 s (get_health panics otherwise); the engine reports reachable
        // again within the bound, without being restarted.
        let recovered = wait_for(RECOVERY_BOUND, || {
            let response = get_health(ctx, ctx.engine_port);
            is_reachable(&response).then_some(response)
        });
        let recovered = recovered.unwrap_or_else(|| {
            panic!(
                "health did not answer 200 reachable within {}s of docker restart",
                RECOVERY_BOUND.as_secs()
            )
        });
        assert_reachable(&recovered, emulator.port);
        // The new run's files are registered for redaction before anything else is logged.
        let _ = EmulatorFiles::read(&emulator.dir);

        let after = (sha256_file(&ca)?, sha256_file(&credentials)?);
        assert_ne!(
            before.0, after.0,
            "ca.pem is unchanged after docker restart"
        );
        assert_ne!(
            before.1, after.1,
            "emulator_credentials is unchanged after docker restart"
        );
        assert!(
            engine.is_running(),
            "the engine exited during the emulator restart"
        );
        assert_eq!(engine.pid, pid, "the engine process changed");
        Ok(())
    });
}
