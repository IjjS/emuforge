//! Safety checks of the engine (test-criteria.md, issue 1): the listener is loopback only, no secret reaches
//! its output, and the AWS environment of the process is ignored.

#[path = "../support/mod.rs"]
mod support;

use std::io::ErrorKind;
use std::net::{IpAddr, Ipv6Addr, SocketAddr};

use support::*;

fn expect_refused(ctx: &Ctx, addr: SocketAddr) {
    match connect(ctx, addr) {
        Err(e) if e.kind() == ErrorKind::ConnectionRefused => ctx.log(format!("{addr} refused")),
        Err(e) => panic!("connect to {addr}: expected refused, got {e}"),
        Ok(_) => panic!("connect to {addr} was accepted; the engine must listen on 127.0.0.1 only"),
    }
}

#[test]
fn binds_loopback_only() {
    check("engine.binds-loopback-only", |ctx| {
        let a = non_loopback_ipv4()?;
        ctx.allow_own_address(IpAddr::V4(a));
        let _engine = Engine::start(ctx, EngineCmd::new(ctx))?;

        let loopback = SocketAddr::from(([127, 0, 0, 1], ctx.engine_port));
        connect(ctx, loopback)
            .unwrap_or_else(|e| panic!("connect to {loopback}: expected accepted, got {e}"));
        let answer = get_health(ctx, ctx.engine_port);
        ctx.log(format!("health on {loopback} answered {}", answer.status));

        expect_refused(ctx, SocketAddr::from((a, ctx.engine_port)));
        expect_refused(
            ctx,
            SocketAddr::from((Ipv6Addr::LOCALHOST, ctx.engine_port)),
        );
        Ok(())
    });
}

/// Which of the run's secret values `text` contains, by name only.
fn secrets_in(text: &str, files: &EmulatorFiles) -> Vec<&'static str> {
    let mut found = Vec::new();
    if text.contains(&files.access_key_id) {
        found.push("aws_access_key_id");
    }
    if text.contains(&files.secret_access_key) {
        found.push("aws_secret_access_key");
    }
    if files
        .ca_lines
        .iter()
        .any(|line| text.contains(line.as_str()))
    {
        found.push("a base64 line of ca.pem");
    }
    found
}

#[test]
fn no_secret_in_output() {
    check("engine.no-secret-in-output", |ctx| {
        let files = EmulatorFiles::read(&emulator_dir(&ctx.home, ctx.emulator_port))
            .ok_or_else(|| Env::new("the run's emulator files are missing or incomplete"))?;
        let canary = format!("emuforge-canary-{}-{}", ctx.run_id, std::process::id());
        let mut bodies: Vec<(String, Vec<u8>)> = Vec::new();

        let mut engine = Engine::start(
            ctx,
            EngineCmd::new(ctx)
                .env("RUST_LOG", "trace")
                .env("EMULATOR_PORT", ctx.emulator_port.to_string()),
        )?;
        let reachable = get_health(ctx, ctx.engine_port);
        assert_reachable(&reachable, ctx.emulator_port);
        bodies.push(("GET /__emuforge/health (reachable)".into(), reachable.body));
        let other = Request::get("/__emuforge/other")
            .send(ctx, ctx.engine_port)
            .unwrap_or_else(|e| panic!("GET /__emuforge/other got no answer: {e}"));
        bodies.push(("GET /__emuforge/other".into(), other.body));
        let foreign = Request::get("/__emuforge/health")
            .host(&format!("example.com:{}", ctx.engine_port))
            .send(ctx, ctx.engine_port)
            .unwrap_or_else(|e| panic!("GET with a foreign Host got no answer: {e}"));
        bodies.push(("GET with a foreign Host".into(), foreign.body));

        // Canaries in the headers a log line could be tempted to print.
        let with_canaries = [
            Request::get("/__emuforge/health")
                .header("User-Agent", &format!("{canary}-user-agent"))
                .header(
                    "Authorization",
                    &format!("AWS4-HMAC-SHA256 Credential={canary}-authorization"),
                ),
            Request::get("/__emuforge/health")
                .header("Origin", &format!("http://{canary}-origin.example")),
            Request::get("/__emuforge/health")
                .host(&format!("{canary}-host.example:{}", ctx.engine_port)),
        ];
        for request in &with_canaries {
            request
                .send(ctx, ctx.engine_port)
                .unwrap_or_else(|e| panic!("request with a canary got no answer: {e}"));
        }
        let first = engine.stop(ctx);

        let p = free_port_without_emulator(&ctx.home)?;
        let mut second = Engine::start(
            ctx,
            EngineCmd::new(ctx)
                .env("RUST_LOG", "trace")
                .env("EMULATOR_PORT", ctx.emulator_port.to_string())
                .arg("--emulator-port")
                .arg(p.to_string()),
        )?;
        let not_started = get_health(ctx, ctx.engine_port);
        assert_unreachable(&not_started, "not_started", p);
        bodies.push((
            "GET /__emuforge/health (not started)".into(),
            not_started.body,
        ));
        let second = second.stop(ctx);

        let mut leaks = Vec::new();
        let streams = [
            ("first engine stdout", &first.stdout),
            ("first engine stderr", &first.stderr),
            ("second engine stdout", &second.stdout),
            ("second engine stderr", &second.stderr),
        ];
        for (name, text) in streams {
            for secret in secrets_in(text, &files) {
                leaks.push(format!("{name} contains {secret}"));
            }
        }
        for (name, body) in &bodies {
            for secret in secrets_in(&String::from_utf8_lossy(body), &files) {
                leaks.push(format!("body of {name} contains {secret}"));
            }
        }
        for (name, text) in [
            ("first engine stdout", &first.stdout),
            ("first engine stderr", &first.stderr),
        ] {
            for part in ["user-agent", "authorization", "origin", "host"] {
                if text.contains(&format!("{canary}-{part}")) {
                    leaks.push(format!("{name} contains the {part} canary"));
                }
            }
        }
        assert!(
            leaks.is_empty(),
            "secrets in the engine's output: {}",
            leaks.join("; ")
        );
        Ok(())
    });
}

#[test]
fn ignores_aws_environment() {
    check("engine.ignores-aws-environment", |ctx| {
        let decoy_endpoint = CountingListener::start()?;
        let d = decoy_endpoint.port;
        let decoys = ctx.temp_dir()?;
        let credentials = decoys.path.join("credentials");
        let config = decoys.path.join("config");
        let written = std::fs::write(
            &credentials,
            "[default]\naws_access_key_id = AKIADECOYDEFAULT0000\naws_secret_access_key = decoy-default-secret\n\
             [emuforge-decoy]\naws_access_key_id = AKIADECOYPROFILE0000\naws_secret_access_key = decoy-profile-secret\n",
        )
        .and_then(|_| {
            std::fs::write(
                &config,
                format!(
                    "[default]\nregion = us-east-1\nendpoint_url = https://127.0.0.1:{d}\n\
                     [profile emuforge-decoy]\nregion = us-east-1\nendpoint_url = https://127.0.0.1:{d}\n"
                ),
            )
        });
        written.map_err(|e| Env::new(format!("cannot write the decoy files: {e}")))?;

        let _engine = Engine::start(
            ctx,
            EngineCmd::new(ctx)
                .env("AWS_PROFILE", "emuforge-decoy")
                .env("AWS_ACCESS_KEY_ID", "AKIADECOYENVIRONMENT")
                .env("AWS_SECRET_ACCESS_KEY", "decoy-environment-secret")
                .env("AWS_SESSION_TOKEN", "decoy-environment-session-token")
                .env(
                    "AWS_SHARED_CREDENTIALS_FILE",
                    credentials.display().to_string(),
                )
                .env("AWS_CONFIG_FILE", config.display().to_string())
                .env("AWS_ENDPOINT_URL", format!("https://127.0.0.1:{d}"))
                .env("EMULATOR_PORT", ctx.emulator_port.to_string()),
        )?;

        let response = get_health(ctx, ctx.engine_port);
        assert_reachable(&response, ctx.emulator_port);
        assert_eq!(
            decoy_endpoint.accepted(),
            0,
            "the AWS_ENDPOINT_URL listener on 127.0.0.1:{d} was contacted"
        );
        Ok(())
    });
}
