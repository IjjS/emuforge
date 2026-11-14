//! The engine server: configuration, the loopback listener, the request guards and the engine's own routes.

#![forbid(unsafe_code)]

mod config;
mod routes;

use std::io;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use emuforge_core::{Emulator, PROBE_DEADLINE, probe};
use tokio::net::TcpListener;

pub use config::{
    Config, DEFAULT_EMULATOR_PORT, DEFAULT_ENGINE_PORT, LISTEN_IP, MAX_IN_FLIGHT, listen_addr,
};
pub use routes::{AppState, HEALTH_PATH, ProbeFn, ProbeFuture, app};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(
        "--port and --emulator-port are both {port}; the engine port must differ from the emulator port"
    )]
    SamePort { port: u16 },
    #[error("cannot listen on {addr}: {source}; choose another --port")]
    Bind { addr: SocketAddr, source: io::Error },
    #[error("the engine stopped serving: {0}")]
    Serve(io::Error),
}

/// Binds `127.0.0.1:<port>` and serves until the process ends. The emulator's files are read from
/// `<home>/.aws/emulator/<emulator port>/` on every health request.
pub async fn serve(config: Config, home: PathBuf) -> Result<(), Error> {
    config.validate()?;
    let addr = listen_addr(&config);
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|source| Error::Bind { addr, source })?;
    tracing::info!(
        listen = %addr,
        emulator_port = config.emulator_port.get(),
        "engine listening"
    );
    let emulator = Emulator::new(&home, config.emulator_port);
    let probed = emulator.clone();
    let probe: ProbeFn = Arc::new(move || {
        let emulator = probed.clone();
        Box::pin(async move { probe(&emulator, PROBE_DEADLINE).await })
    });
    let state = AppState {
        engine_port: config.port,
        emulator,
        probe,
        max_in_flight: MAX_IN_FLIGHT,
    };
    axum::serve(listener, app(state))
        .await
        .map_err(Error::Serve)
}
