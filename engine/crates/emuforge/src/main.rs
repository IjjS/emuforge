//! `emuforge`: the EmuForge binary. `serve` runs the engine and, when this build embeds it, Studio.

#![forbid(unsafe_code)]

mod cli;
#[cfg(test)]
mod embed;
mod studio;

use std::env;
use std::path::PathBuf;
use std::process::ExitCode;

use anyhow::Context;
use clap::{CommandFactory, Parser};
use emuforge_server::{Config, serve};
use tracing_subscriber::EnvFilter;

use cli::{Cli, Command};

fn main() -> ExitCode {
    let Cli {
        command: Command::Serve(config),
    } = Cli::parse();
    let Some(home) = env::var_os("HOME").filter(|home| !home.is_empty()) else {
        eprintln!(
            "error: HOME is not set; the engine reads the emulator's files from $HOME/.aws/emulator/<port>/"
        );
        return ExitCode::FAILURE;
    };
    if let Err(error) = config.validate() {
        // The usage line of `serve`, not of the bare binary.
        let command = Cli::command();
        command
            .find_subcommand("serve")
            .cloned()
            .unwrap_or(command)
            .bin_name("emuforge serve")
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
    let studio = studio::embedded()?;
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("cannot start the async runtime")?
        .block_on(serve(config, home, studio))?;
    Ok(())
}
