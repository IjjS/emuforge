//! `emuforge serve` built without Studio embedded serves the engine only (test-criteria.md, issue 484).

#[path = "../support/mod.rs"]
mod support;

use std::io::ErrorKind;
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::Duration;

use support::*;

/// How long after the engine answers its stderr may take to hold the line about Studio.
const LINE_BOUND: Duration = Duration::from_secs(5);

#[test]
fn serve_without_studio_serves_the_engine_only() {
    check("engine.serve-without-studio-serves-the-engine-only", |ctx| {
        let studio_port = free_port()?;
        if studio_port == ctx.engine_port || studio_port == ctx.emulator_port {
            return Err(Env::new(format!(
                "the free studio port {studio_port} is the engine's or the emulator's"
            )));
        }
        let mut engine = Engine::start(
            ctx,
            EngineCmd::new(ctx).env("EMUFORGE_STUDIO_PORT", studio_port.to_string()),
        )?;

        let answer = get_health(ctx, ctx.engine_port);
        ctx.log(format!("health answered {}", answer.status));
        assert_reachable(&answer, ctx.emulator_port);

        let line = wait_for(LINE_BOUND, || {
            engine
                .stderr_now()
                .lines()
                .find(|l| l.contains("not served") && l.contains("embed-studio"))
                .map(str::to_owned)
        });
        let stderr = engine.stderr_now();
        assert!(
            line.is_some(),
            "stderr holds no line saying Studio is not served and naming embed-studio within {}s: {}",
            LINE_BOUND.as_secs(),
            secrets::redact(stderr.trim())
        );
        ctx.log(format!("stderr line: {}", line.unwrap_or_default()));

        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, studio_port));
        match TcpStream::connect_timeout(&addr, Duration::from_secs(2)) {
            Ok(_) => panic!("something listens on the studio port {addr}; expected refused"),
            Err(e) => assert_eq!(
                e.kind(),
                ErrorKind::ConnectionRefused,
                "connecting to the studio port {addr}: {e}; expected refused"
            ),
        }
        assert!(engine.is_running(), "the engine exited during the check");
        engine.stop(ctx);
        Ok(())
    });
}
