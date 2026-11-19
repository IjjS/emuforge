//! The binary's command line: `emuforge serve`, `--help` and `--version`.

use clap::{Parser, Subcommand};
use emuforge_server::Config;

#[derive(Debug, Parser)]
#[command(
    name = "emuforge",
    version,
    about = "EmuForge: Studio and the engine in front of the local aws-emulator",
    subcommand_required = true,
    arg_required_else_help = false
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, PartialEq, Eq, Subcommand)]
pub enum Command {
    /// Serve the engine and, when this build embeds it, Studio, in the foreground
    Serve(#[command(flatten)] Config),
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr};
    use std::num::NonZeroU16;

    use clap::error::ErrorKind;

    use super::*;

    fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        Cli::try_parse_from(std::iter::once("emuforge").chain(args.iter().copied()))
    }

    fn port(value: u16) -> NonZeroU16 {
        NonZeroU16::new(value).unwrap()
    }

    #[test]
    fn cli_without_subcommand_is_usage_error() {
        let error = parse(&[]).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::MissingSubcommand);
        assert_eq!(error.exit_code(), 2);
        let text = error.render().to_string();
        assert!(text.contains("Usage: emuforge <COMMAND>"), "{text}");
    }

    #[test]
    fn cli_unknown_subcommand_is_usage_error() {
        let error = parse(&["start"]).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidSubcommand);
        assert_eq!(error.exit_code(), 2);
        let text = error.render().to_string();
        assert!(text.contains("unrecognized subcommand 'start'"), "{text}");
    }

    #[test]
    fn cli_help_names_serve() {
        let error = parse(&["--help"]).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::DisplayHelp);
        assert_eq!(error.exit_code(), 0);
        let text = error.render().to_string();
        assert!(
            text.lines()
                .any(|line| line.trim_start().starts_with("serve ")),
            "{text}"
        );
    }

    #[test]
    fn cli_version_prints_workspace_version() {
        let error = parse(&["--version"]).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::DisplayVersion);
        assert_eq!(error.exit_code(), 0);
        assert_eq!(env!("CARGO_PKG_VERSION"), "0.1.0");
        assert_eq!(error.render().to_string(), "emuforge 0.1.0\n");
    }

    #[test]
    fn cli_serve_help_lists_every_flag_with_default_and_variable() {
        let error = parse(&["serve", "--help"]).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::DisplayHelp);
        assert_eq!(error.exit_code(), 0);
        let text = error.render().to_string();
        let cases = [
            ("--port", "[default: 8297]", Some("EMUFORGE_ENGINE_PORT")),
            ("--emulator-port", "[default: 9297]", Some("EMULATOR_PORT")),
            (
                "--studio-port",
                "[default: 8296]",
                Some("EMUFORGE_STUDIO_PORT"),
            ),
            ("--listen-address", "[default: 127.0.0.1]", None),
        ];
        for (flag, default, variable) in cases {
            let start = text
                .find(&format!("      {flag} "))
                .unwrap_or_else(|| panic!("case {flag}: no line in {text}"));
            // An entry runs until the next flag's entry.
            let entry = text[start..].split("\n      --").next().unwrap_or_default();
            assert!(entry.contains(default), "case {flag}: {entry}");
            match variable {
                Some(variable) => assert!(
                    entry.contains(&format!("[env: {variable}=")),
                    "case {flag}: {entry}"
                ),
                None => assert!(!entry.contains("env:"), "case {flag}: {entry}"),
            }
        }
    }

    #[test]
    fn cli_serve_help_lists_settings_dir_and_form_with_their_variables() {
        let error = parse(&["serve", "--help"]).unwrap_err();
        let text = error.render().to_string();
        for (flag, variable) in [
            ("--settings-dir", "EMUFORGE_SETTINGS_DIR"),
            ("--form", "EMUFORGE_FORM"),
        ] {
            let start = text
                .find(&format!("      {flag} "))
                .unwrap_or_else(|| panic!("case {flag}: no line in {text}"));
            let entry = text[start..].split("\n      --").next().unwrap_or_default();
            assert!(
                entry.contains(&format!("[env: {variable}=")),
                "case {flag}: {entry}"
            );
        }
        let start = text.find("      --emulator-port ").unwrap();
        let entry = text[start..].split("\n      --").next().unwrap_or_default();
        assert!(
            entry.contains("local") && entry.contains("settings file is absent"),
            "{entry}"
        );
    }

    #[test]
    fn cli_serve_with_every_flag_is_serve_with_those_values() {
        let cli = parse(&[
            "serve",
            "--port",
            "8400",
            "--emulator-port",
            "9400",
            "--studio-port",
            "8396",
            "--listen-address",
            "0.0.0.0",
        ])
        .unwrap();
        let Command::Serve(config) = cli.command;
        assert_eq!(config.port, port(8400));
        assert_eq!(config.emulator_port, port(9400));
        assert_eq!(config.studio_port, port(8396));
        assert_eq!(config.listen_address, IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    }
}
