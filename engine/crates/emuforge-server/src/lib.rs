//! The engine server as a library: configuration, the engine's listener, guards and routes, Studio's server over
//! a build it is given, and `serve`, which runs both in one process.

#![forbid(unsafe_code)]

mod aws_error;
mod bound;
mod browser;
mod channel;
mod config;
mod hosts;
mod limit;
mod listener;
mod routes;
mod session;
mod studio;
mod targets;

use std::future::IntoFuture;
use std::io;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

pub use aws_error::{ErrorType, Protocol, render};
pub use bound::Bound;
pub use browser::{PREFLIGHT_MAX_AGE_SECS, SESSION_HEADER, StudioOrigin, is_engine_path};
pub use channel::CHANNEL_PATH;
pub use config::{
    AllowHosts, Config, DEFAULT_EMULATOR_PORT, DEFAULT_ENGINE_PORT, DEFAULT_STUDIO_PORT, Form,
    LISTEN_IP, MAX_IN_FLIGHT, allow_host_warning, engine_addr, listen_warning, seed_settings,
    settings_dir, studio_addr,
};
use emuforge_core::{Limits, PROBE_DEADLINE, Replaced, Settings, Store, check, probe, relay};
pub use hosts::{AcceptedHost, AcceptedHosts, AllowedHost, AllowedHostError};
pub use listener::{CLIENT_WRITE_IDLE, DRAIN_BOUND, Drain, IdleListener, MAX_DRAINING};
pub use routes::{
    AppState, Apps, HEALTH_PATH, ProbeFn, ProbeFuture, RelayFn, RelayFuture, SESSION_PATH, app,
    apps,
};
pub use session::SessionToken;
pub use studio::{STUDIO_CONTENT_TYPES, StudioFiles, StudioState, studio_app};
pub use targets::{ADD_BODY_CAP, TARGETS_PATH, TestFn, TestFuture};

use config::{ENGINE_PORT, STUDIO_PORT, variable_of};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(
        "--port (EMUFORGE_ENGINE_PORT) and --emulator-port (EMULATOR_PORT) are both {port}; the engine port must differ from the emulator port"
    )]
    SamePort { port: u16 },
    // `error` is part of the message, not a `source`, so a chained print shows the OS error once.
    #[error("cannot listen on {addr}: {error}; choose another {flag} ({variable})")]
    Bind {
        addr: SocketAddr,
        flag: &'static str,
        variable: &'static str,
        error: io::Error,
    },
    #[error("the engine stopped serving: {0}")]
    Serve(io::Error),
    #[error(
        "--studio-port (EMUFORGE_STUDIO_PORT) {port} equals {other} ({}); choose another --studio-port",
        variable_of(.other)
    )]
    StudioPortCollides { port: u16, other: &'static str },
    #[error("cannot create a session token: the operating system's random source failed ({kind})")]
    SessionToken { kind: String },
    #[error(
        "--settings-dir (EMUFORGE_SETTINGS_DIR) {} is under ~/.aws; EmuForge keeps its settings outside ~/.aws, choose another folder",
        .dir.display()
    )]
    SettingsDirUnderAws { dir: PathBuf },
    #[error("cannot read the working directory to resolve --settings-dir: {0}")]
    WorkingDir(io::Error),
    #[error("Studio's build has no index.html; build Studio with `bun run build` in studio/")]
    StudioIndexMissing,
    #[error(
        "Studio's build holds the path {path:?}, which is not a relative path inside the build; rebuild Studio with `bun run build` in studio/"
    )]
    StudioPathInvalid { path: String },
}

impl Error {
    /// The engine's listener could not be bound at `addr`.
    pub fn engine_bind(addr: SocketAddr, error: io::Error) -> Error {
        let (flag, variable) = ENGINE_PORT;
        Error::Bind {
            addr,
            flag,
            variable,
            error,
        }
    }

    /// Studio's listener could not be bound at `addr`.
    pub fn studio_bind(addr: SocketAddr, error: io::Error) -> Error {
        let (flag, variable) = STUDIO_PORT;
        Error::Bind {
            addr,
            flag,
            variable,
            error,
        }
    }
}

/// The settings step of `serve`. In the Compose form the file is made to hold exactly `seed` (its one target
/// `compose`), with an info line when it was written; then one line names the file, the form and the active
/// target, or says that the file cannot be used. Nothing stops the start: an unusable file is answered `503` at
/// every use until it is fixed or removed. No line holds anything of the emulator's files.
pub async fn settings_step(store: &Store, form: Form, seed: &Settings) {
    let file = store.file();
    if form == Form::Compose {
        match store.replace(seed).await {
            Ok(Replaced::Created) => {
                tracing::info!(file = %file.display(), "settings file written with the one target compose");
            }
            Ok(Replaced::Replaced) => tracing::info!(
                file = %file.display(),
                "settings file replaced: the Compose form holds only the one target compose"
            ),
            Ok(Replaced::Unchanged) => {}
            Err(error) => tracing::warn!("{error}"),
        }
    }
    match store.load().await {
        Ok(settings) => {
            let active = settings.active();
            tracing::info!(
                "settings file {}, form {form}, active target {} at {}",
                file.display(),
                active.name(),
                active.endpoint()
            );
        }
        Err(error) => tracing::warn!(
            "settings file {}, form {form}: the file cannot be used, every request is answered 503 until it is fixed or removed: {error}",
            file.display()
        ),
    }
}

/// Resolves the settings folder, creates the session token, binds the engine's listener and, when `studio` is
/// given, Studio's, then serves both until the process ends or either stops. When the folder is refused or either
/// listener cannot be bound, nothing is served. The active target is read from the settings file on every health
/// and every relayed request, and its emulator's files from `<home>/.aws/emulator/<its port>/`.
pub async fn serve(
    config: Config,
    home: PathBuf,
    studio: Option<StudioFiles>,
) -> Result<(), Error> {
    let prepared = prepare(&config, &home)?;
    let bound = Bound::bind(config, studio).await?;
    run(prepared, bound, home).await
}

/// Serves what `bound` holds, as `serve` does once it has bound: the same steps before and after the bind. When
/// the folder of its `Config` is refused, nothing is served and the listeners end with `bound`.
pub async fn serve_bound(bound: Bound, home: PathBuf) -> Result<(), Error> {
    let prepared = prepare(bound.config(), &home)?;
    run(prepared, bound, home).await
}

/// What the step before the binds hands the step after them.
struct Prepared {
    dir: PathBuf,
    session: Arc<SessionToken>,
}

/// The step of `serve` before the binds: the `Config` is checked, the settings folder resolved and refused at or
/// under `~/.aws`, the session token created and the listen warning logged.
fn prepare(config: &Config, home: &Path) -> Result<Prepared, Error> {
    config.validate()?;
    let cwd = std::env::current_dir().map_err(Error::WorkingDir)?;
    let dir = settings_dir(config, home, &cwd)?;
    let session = Arc::new(SessionToken::generate()?);
    if let Some(warning) = listen_warning(config.listen_address) {
        tracing::warn!(listen_address = %config.listen_address, "{warning}");
    }
    Ok(Prepared { dir, session })
}

/// The step of `serve` after the binds: the host warnings, the settings step, and serving both listeners until
/// either stops.
async fn run(prepared: Prepared, bound: Bound, home: PathBuf) -> Result<(), Error> {
    let Prepared { dir, session } = prepared;
    let (config, engine_listener, studio) = bound.into_parts();
    let studio_origin = StudioOrigin::new(config.studio_port);
    let allowed = config.allow_hosts.as_slice();
    let accepted_hosts = AcceptedHosts::new(config.studio_port, allowed.to_vec());
    let engine_at = engine_addr(&config);
    let studio = studio.map(|(listener, files)| (listener, studio_addr(&config), files));
    if studio.is_some() {
        if let Some(warning) = allow_host_warning(allowed, config.studio_port) {
            tracing::warn!("{warning}");
        }
    } else if !allowed.is_empty() {
        tracing::warn!(
            "--allow-host (EMUFORGE_ALLOW_HOSTS) has no effect: this build embeds no Studio, so there is no Studio \
             port to answer under those names; the engine is served as without them"
        );
    }
    tracing::info!(
        listen = %engine_at,
        emulator_port = config.emulator_port.get(),
        studio_origin = studio_origin.as_str(),
        "engine listening"
    );
    let seed = seed_settings(config.form, config.emulator_port);
    let settings = Arc::new(Store::new(dir, seed.clone()));
    settings_step(&settings, config.form, &seed).await;
    let probe: ProbeFn =
        Arc::new(|emulator| Box::pin(async move { probe(&emulator, PROBE_DEADLINE).await }));
    let relay: RelayFn = Arc::new(|emulator, request| {
        Box::pin(async move { relay(&emulator, request, &Limits::DEFAULT).await })
    });
    let test: TestFn = Arc::new(|emulator| {
        Box::pin(async move { check::test(&emulator, PROBE_DEADLINE, SystemTime::now()).await })
    });
    let state = AppState {
        engine_port: config.port,
        studio_port: config.studio_port,
        form: config.form,
        home,
        settings,
        probe,
        relay,
        test,
        max_in_flight: MAX_IN_FLIGHT,
        studio_origin,
        session,
        accepted_hosts: accepted_hosts.clone(),
    };
    let Apps { engine, channel } = apps(state);
    let engine = axum::serve(
        IdleListener::new(engine_listener, CLIENT_WRITE_IDLE),
        engine,
    )
    .into_future();
    let Some((listener, studio_at, files)) = studio else {
        tracing::info!(
            "studio not served: this build embeds no Studio; build with --features embed-studio"
        );
        return engine.await.map_err(Error::Serve);
    };
    tracing::info!(listen = %studio_at, engine_port = config.port.get(), "studio listening");
    let studio = axum::serve(
        IdleListener::new(listener, CLIENT_WRITE_IDLE),
        studio_app(StudioState {
            studio_port: config.studio_port,
            engine_port: config.port,
            files: Arc::new(files),
            max_in_flight: MAX_IN_FLIGHT,
            accepted_hosts,
            channel,
        }),
    )
    .into_future();
    tokio::try_join!(engine, studio)
        .map(|_| ())
        .map_err(Error::Serve)
}
