//! `emuforge-server`: the EmuForge engine on `127.0.0.1`.

#![forbid(unsafe_code)]

use std::env;
use std::path::PathBuf;
use std::process::ExitCode;

use anyhow::Context;
use clap::{CommandFactory, Parser};
use emuforge_server::{Config, serve};
use tracing_subscriber::EnvFilter;

fn main() -> ExitCode {
    let Some(home) = env::var_os("HOME").filter(|home| !home.is_empty()) else {
        eprintln!(
            "error: HOME is not set; the engine reads the emulator's files from $HOME/.aws/emulator/<port>/"
        );
        return ExitCode::FAILURE;
    };
    let config = Config::parse();
    if let Err(error) = config.validate() {
        Config::command()
            .error(clap::error::ErrorKind::ArgumentConflict, error)
            .exit();
    }
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .init();
    match run(config, PathBuf::from(home)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error:#}");
            ExitCode::FAILURE
        }
    }
}

fn run(config: Config, home: PathBuf) -> anyhow::Result<()> {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("cannot start the async runtime")?
        .block_on(serve(config, home))?;
    Ok(())
}
