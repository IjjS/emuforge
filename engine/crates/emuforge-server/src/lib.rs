//! The engine server: configuration, the loopback listener, the request guards and the engine's own routes.

#![forbid(unsafe_code)]

mod aws_error;
mod browser;
mod config;
mod limit;
mod listener;
mod routes;
mod session;

use std::io;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use emuforge_core::{Emulator, Limits, PROBE_DEADLINE, probe, relay};
use tokio::net::TcpListener;

pub use aws_error::{ErrorType, Protocol, render};
pub use browser::{PREFLIGHT_MAX_AGE_SECS, SESSION_HEADER, StudioOrigin, is_engine_path};
pub use config::{
    Config, DEFAULT_EMULATOR_PORT, DEFAULT_ENGINE_PORT, DEFAULT_STUDIO_PORT, LISTEN_IP,
    MAX_IN_FLIGHT, listen_addr,
};
pub use listener::{CLIENT_WRITE_IDLE, IdleListener};
pub use routes::{
    AppState, HEALTH_PATH, ProbeFn, ProbeFuture, RelayFn, RelayFuture, SESSION_PATH, app,
};
pub use session::SessionToken;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(
        "--port and --emulator-port are both {port}; the engine port must differ from the emulator port"
    )]
    SamePort { port: u16 },
    // `error` is part of the message, not a `source`, so a chained print shows the OS error once.
    #[error("cannot listen on {addr}: {error}; choose another --port")]
    Bind { addr: SocketAddr, error: io::Error },
    #[error("the engine stopped serving: {0}")]
    Serve(io::Error),
    #[error("--studio-port {port} equals {other}; choose another --studio-port")]
    StudioPortCollides { port: u16, other: &'static str },
    #[error("cannot create a session token: the operating system's random source failed ({kind})")]
    SessionToken { kind: String },
}

/// Creates the session token, binds `127.0.0.1:<port>` and serves until the process ends. The emulator's files
/// are read from `<home>/.aws/emulator/<emulator port>/` on every health and every relayed request.
pub async fn serve(config: Config, home: PathBuf) -> Result<(), Error> {
    config.validate()?;
    let session = Arc::new(SessionToken::generate()?);
    let studio_origin = StudioOrigin::new(config.studio_port);
    let addr = listen_addr(&config);
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|error| Error::Bind { addr, error })?;
    tracing::info!(
        listen = %addr,
        emulator_port = config.emulator_port.get(),
        studio_origin = studio_origin.as_str(),
        "engine listening"
    );
    let emulator = Emulator::new(&home, config.emulator_port);
    let probed = emulator.clone();
    let probe: ProbeFn = Arc::new(move || {
        let emulator = probed.clone();
        Box::pin(async move { probe(&emulator, PROBE_DEADLINE).await })
    });
    let relayed = emulator.clone();
    let relay: RelayFn = Arc::new(move |request| {
        let emulator = relayed.clone();
        Box::pin(async move { relay(&emulator, request, &Limits::DEFAULT).await })
    });
    let state = AppState {
        engine_port: config.port,
        emulator,
        probe,
        relay,
        max_in_flight: MAX_IN_FLIGHT,
        studio_origin,
        session,
    };
    axum::serve(IdleListener::new(listener, CLIENT_WRITE_IDLE), app(state))
        .await
        .map_err(Error::Serve)
}
