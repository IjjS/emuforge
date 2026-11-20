//! The listeners of one `Config`, bound before anything is served: by `serve` on the configured ports, or by
//! [`Bound::bind_free`] on ports the system picks, which a caller then serves with `serve_bound`.

use std::io;
use std::net::SocketAddr;
use std::num::NonZeroU16;

use tokio::net::TcpListener;

use crate::config::{ENGINE_PORT, STUDIO_PORT, engine_addr, studio_addr};
use crate::{Config, Error, StudioFiles};

/// How many ports [`Bound::bind_free`] takes from the system for one listener before it gives up on finding one
/// that its `Config` does not already name.
const FREE_TRIES: usize = 8;

/// The text of the error [`Bound::bind_free`] returns when every port the system offered was one its `Config`
/// names for something else.
const OFFERED_PORTS_TAKEN: &str =
    "every port the system offered is the emulator port or the Studio port of this configuration";

/// The listeners of one `Config`, bound and held, with that `Config` and Studio's files when Studio is served.
/// Nothing outside the crate can pair a `Config` with listeners other than its own: the guards built from its
/// ports always describe the listeners that are served.
#[derive(Debug)]
pub struct Bound {
    config: Config,
    engine: TcpListener,
    studio: Option<(TcpListener, StudioFiles)>,
}

impl Bound {
    /// Binds a port the system picks at `config.listen_address` for the engine and, when `studio` is given,
    /// another for Studio, and returns them held, with `config`'s `port` (and then `studio_port`) set to them.
    /// The ports it picks never equal `config.emulator_port`, nor `config.studio_port` when Studio is not served.
    pub async fn bind_free(mut config: Config, studio: Option<StudioFiles>) -> Result<Bound, Error> {
        let mut avoid = vec![config.emulator_port];
        if studio.is_none() {
            avoid.push(config.studio_port);
        }
        let (engine, port) = bind_free_port(&config, &avoid, ENGINE_PORT).await?;
        config.port = port;
        let studio = match studio {
            Some(files) => {
                // The engine's listener is held here, so the system cannot give Studio the same port.
                let (listener, port) = bind_free_port(&config, &avoid, STUDIO_PORT).await?;
                config.studio_port = port;
                Some((listener, files))
            }
            None => None,
        };
        Ok(Bound {
            config,
            engine,
            studio,
        })
    }

    /// The `Config` these listeners belong to; its ports are the ports they hold.
    pub fn config(&self) -> &Config {
        &self.config
    }

    /// The product's bind: the engine's listener at `engine_addr`, then, when `studio` is given, Studio's at
    /// `studio_addr`. A failed Studio bind returns, and drops the engine's listener with it.
    pub(crate) async fn bind(config: Config, studio: Option<StudioFiles>) -> Result<Bound, Error> {
        let engine_at = engine_addr(&config);
        let engine = TcpListener::bind(engine_at)
            .await
            .map_err(|error| Error::engine_bind(engine_at, error))?;
        let studio = match studio {
            Some(files) => {
                let studio_at = studio_addr(&config);
                let listener = TcpListener::bind(studio_at)
                    .await
                    .map_err(|error| Error::studio_bind(studio_at, error))?;
                Some((listener, files))
            }
            None => None,
        };
        Ok(Bound {
            config,
            engine,
            studio,
        })
    }

    /// The `Config`, the engine's listener and Studio's with its files, for the step that serves them.
    pub(crate) fn into_parts(self) -> (Config, TcpListener, Option<(TcpListener, StudioFiles)>) {
        (self.config, self.engine, self.studio)
    }
}

/// A listener at `config.listen_address` on a port the system picks that is not in `avoid`, with that port. A
/// port in `avoid` is held until the next has been bound, so the system does not offer it again, and the tries
/// are bounded by [`FREE_TRIES`]. `flag` names the listener in the error.
async fn bind_free_port(
    config: &Config,
    avoid: &[NonZeroU16],
    (flag, variable): (&'static str, &'static str),
) -> Result<(TcpListener, NonZeroU16), Error> {
    let addr = SocketAddr::new(config.listen_address, 0);
    let bind_error = |error| Error::Bind {
        addr,
        flag,
        variable,
        error,
    };
    let mut refused = Vec::new();
    for _ in 0..FREE_TRIES {
        let listener = TcpListener::bind(addr).await.map_err(bind_error)?;
        let port = listener.local_addr().map_err(bind_error)?.port();
        match NonZeroU16::new(port) {
            Some(port) if !avoid.contains(&port) => return Ok((listener, port)),
            _ => refused.push(listener),
        }
    }
    Err(bind_error(io::Error::new(
        io::ErrorKind::AddrInUse,
        OFFERED_PORTS_TAKEN,
    )))
}
