use std::fmt;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::num::NonZeroU16;
use std::path::{Component, Path, PathBuf};

use emuforge_core::{Endpoint, Settings, TargetName};

use crate::Error;

#[allow(
    clippy::expect_used,
    reason = "a constant, checked when the crate compiles"
)]
pub const DEFAULT_ENGINE_PORT: NonZeroU16 = NonZeroU16::new(8297).expect("8297 is not zero");
#[allow(
    clippy::expect_used,
    reason = "a constant, checked when the crate compiles"
)]
pub const DEFAULT_EMULATOR_PORT: NonZeroU16 = NonZeroU16::new(9297).expect("9297 is not zero");
#[allow(
    clippy::expect_used,
    reason = "a constant, checked when the crate compiles"
)]
pub const DEFAULT_STUDIO_PORT: NonZeroU16 = NonZeroU16::new(8296).expect("8296 is not zero");
/// Requests in flight across every route; one more is answered `503 Busy` at once.
pub const MAX_IN_FLIGHT: usize = 32;
/// The address both listeners bind unless `--listen-address` names another.
pub const LISTEN_IP: Ipv4Addr = Ipv4Addr::LOCALHOST;

/// The engine port's flag and variable.
pub(crate) const ENGINE_PORT: (&str, &str) = ("--port", "EMUFORGE_ENGINE_PORT");
/// The emulator port's flag and variable.
pub(crate) const EMULATOR_PORT: (&str, &str) = ("--emulator-port", "EMULATOR_PORT");
/// The Studio port's flag and variable.
pub(crate) const STUDIO_PORT: (&str, &str) = ("--studio-port", "EMUFORGE_STUDIO_PORT");

/// The settings folder's flag and variable.
pub(crate) const SETTINGS_DIR: (&str, &str) = ("--settings-dir", "EMUFORGE_SETTINGS_DIR");

/// How EmuForge is run: on the host (`native`, any number of targets) or as the Compose form (`compose`, one
/// target, its own emulator).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, clap::ValueEnum)]
pub enum Form {
    #[default]
    Native,
    Compose,
}

impl Form {
    pub fn as_str(self) -> &'static str {
        match self {
            Form::Native => "native",
            Form::Compose => "compose",
        }
    }

    /// The name of the one target the form starts with: `local` (native), `compose` (compose).
    pub fn seed_name(self) -> &'static str {
        match self {
            Form::Native => "local",
            Form::Compose => "compose",
        }
    }

    /// The settings folder under `HOME` when `--settings-dir` is not given.
    fn default_dir(self, home: &Path) -> PathBuf {
        let folder = match self {
            Form::Native => "emuforge",
            Form::Compose => "emuforge-compose",
        };
        home.join(".config").join(folder)
    }
}

impl fmt::Display for Form {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// The settings of `serve`. A flag wins over its environment variable; `--listen-address` has no variable.
#[derive(Debug, Clone, PartialEq, Eq, clap::Args)]
pub struct Config {
    /// Port the engine listens on, at --listen-address
    #[arg(long, env = "EMUFORGE_ENGINE_PORT", default_value_t = DEFAULT_ENGINE_PORT)]
    pub port: NonZeroU16,
    /// Port of the target local, https://127.0.0.1:<port>, while the settings file is absent; in the Compose
    /// form, the port of its one target compose
    #[arg(long = "emulator-port", env = "EMULATOR_PORT", default_value_t = DEFAULT_EMULATOR_PORT)]
    pub emulator_port: NonZeroU16,
    /// Port Studio is served on, at --listen-address, when this build embeds Studio; the engine serves browsers
    /// only from http://127.0.0.1:<port>
    #[arg(long = "studio-port", env = "EMUFORGE_STUDIO_PORT", default_value_t = DEFAULT_STUDIO_PORT)]
    pub studio_port: NonZeroU16,
    /// IP address both listeners bind; any other than 127.0.0.1 lets anything that can reach it use the emulator
    /// through the engine
    #[arg(long = "listen-address", value_name = "IP", default_value_t = IpAddr::V4(LISTEN_IP))]
    pub listen_address: IpAddr,
    /// Folder of the settings file targets.json [default: $HOME/.config/emuforge, or
    /// $HOME/.config/emuforge-compose in the Compose form]; never ~/.aws or a folder under it
    #[arg(long = "settings-dir", env = "EMUFORGE_SETTINGS_DIR", value_name = "DIR")]
    pub settings_dir: Option<PathBuf>,
    /// How EmuForge is run: native on the host, or compose, which holds one target, its own emulator
    #[arg(long, env = "EMUFORGE_FORM", value_enum, default_value_t = Form::Native)]
    pub form: Form,
}

impl Config {
    /// The engine port must differ from the emulator port, and the studio port from both.
    pub fn validate(&self) -> Result<(), Error> {
        if self.port == self.emulator_port {
            return Err(Error::SamePort {
                port: self.port.get(),
            });
        }
        for (other, port) in [
            (ENGINE_PORT.0, self.port),
            (EMULATOR_PORT.0, self.emulator_port),
        ] {
            if self.studio_port == port {
                return Err(Error::StudioPortCollides {
                    port: port.get(),
                    other,
                });
            }
        }
        Ok(())
    }
}

/// The settings folder `serve` uses: `--settings-dir` made absolute against `cwd`, or the form's folder under
/// `home`. A folder that is `<home>/.aws` or under it is refused; the comparison is of path components after
/// `.` and `..` are resolved lexically, and no symlink is followed.
pub fn settings_dir(config: &Config, home: &Path, cwd: &Path) -> Result<PathBuf, Error> {
    let dir = match &config.settings_dir {
        Some(dir) => lexical(&cwd.join(dir)),
        None => config.form.default_dir(home),
    };
    if dir.starts_with(lexical(&home.join(".aws"))) {
        return Err(Error::SettingsDirUnderAws { dir });
    }
    Ok(dir)
}

/// `path` with `.` dropped and each `..` taking off the component before it; `..` at the root stays at the root.
fn lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

/// The settings used while the file is absent: the form's one target at `https://127.0.0.1:<emulator port>`,
/// active.
pub fn seed_settings(form: Form, emulator_port: NonZeroU16) -> Settings {
    #[allow(
        clippy::expect_used,
        reason = "a fixed lowercase name and https://127.0.0.1 with a non-zero port always parse"
    )]
    let (name, endpoint) = (
        TargetName::parse(form.seed_name()).expect("the seed name follows the name rule"),
        Endpoint::parse(&format!("https://127.0.0.1:{emulator_port}"))
            .expect("127.0.0.1 with a port is a loopback endpoint"),
    );
    Settings::seed(name, endpoint)
}

/// The variable of a port flag, for the texts of the refusals that name the flag.
pub(crate) fn variable_of(flag: &str) -> &'static str {
    [ENGINE_PORT, EMULATOR_PORT, STUDIO_PORT, SETTINGS_DIR]
        .into_iter()
        .find(|(name, _)| *name == flag)
        .map_or("", |(_, variable)| variable)
}

/// `<listen address>:<port>`: the address `serve` binds for the engine.
pub fn engine_addr(config: &Config) -> SocketAddr {
    SocketAddr::new(config.listen_address, config.port.get())
}

/// `<listen address>:<studio port>`: the address `serve` binds for Studio, when the build embeds it.
pub fn studio_addr(config: &Config) -> SocketAddr {
    SocketAddr::new(config.listen_address, config.studio_port.get())
}

/// The warning `serve` logs before it binds an address other than `127.0.0.1`; `None` for `127.0.0.1`. Every other
/// address warns, `::1` and the rest of `127.0.0.0/8` included: the rule names `127.0.0.1`.
pub fn listen_warning(ip: IpAddr) -> Option<String> {
    (ip != IpAddr::V4(LISTEN_IP)).then(|| {
        format!(
            "listening on {ip}, not on loopback: anything that can reach {ip} can open Studio and use the emulator \
             through the engine; use --listen-address only inside a container whose ports are published on 127.0.0.1"
        )
    })
}

#[cfg(test)]
mod tests {
    use clap::error::ErrorKind;
    use clap::{Args, FromArgMatches};

    use super::*;

    /// `Config::try_parse_from` with every environment binding removed, so the process environment (a check
    /// run sets the engine's variables) plays no part.
    fn parse(args: &[&str]) -> Result<Config, clap::Error> {
        let command = ["port", "emulator_port", "studio_port", "settings_dir", "form"]
            .into_iter()
            .fold(command(), |command, id| {
                command.mut_arg(id, |arg| arg.env(None))
            });
        let matches = command
            .try_get_matches_from(std::iter::once("emuforge-server").chain(args.iter().copied()))?;
        Config::from_arg_matches(&matches)
    }

    fn command() -> clap::Command {
        Config::augment_args(clap::Command::new("emuforge-server"))
    }

    fn port(value: u16) -> NonZeroU16 {
        NonZeroU16::new(value).unwrap()
    }

    fn ports(engine: u16, emulator: u16, studio: u16) -> Config {
        Config {
            port: port(engine),
            emulator_port: port(emulator),
            studio_port: port(studio),
            listen_address: IpAddr::V4(LISTEN_IP),
            settings_dir: None,
            form: Form::Native,
        }
    }

    #[test]
    fn studio_port_absent_is_8296() {
        assert_eq!(parse(&[]).unwrap().studio_port, port(8296));
    }

    #[test]
    fn studio_port_in_range_is_that_value() {
        for value in ["1", "8100", "65535"] {
            let config = parse(&["--studio-port", value])
                .unwrap_or_else(|error| panic!("case {value}: {error}"));
            assert_eq!(config.studio_port.to_string(), value, "case {value}");
        }
    }

    #[test]
    fn studio_port_out_of_range_or_not_a_number_is_a_usage_error_naming_the_flag() {
        for (name, value) in [
            ("0", "0"),
            ("65536", "65536"),
            ("abc", "abc"),
            ("empty", ""),
        ] {
            let error = parse(&["--studio-port", value]).unwrap_err();
            let text = error.to_string();
            assert_eq!(
                error.kind(),
                ErrorKind::ValueValidation,
                "case {name}: {text}"
            );
            assert!(text.contains("--studio-port"), "case {name}: {text}");
        }
    }

    #[test]
    fn studio_port_help_shows_default_and_variable() {
        let help = command().render_help().to_string();
        let line = help
            .lines()
            .find(|line| line.trim_start().starts_with("--studio-port "))
            .unwrap_or_else(|| panic!("no help line for --studio-port: {help}"));
        assert!(line.contains("[default: 8296]"), "{line}");
        assert!(line.contains("EMUFORGE_STUDIO_PORT"), "{line}");
    }

    #[test]
    fn validate_studio_port_equal_to_another_port_is_studio_port_collides_naming_both() {
        let cases = [
            ("--port", ports(8400, 9400, 8400), 8400),
            ("--emulator-port", ports(8400, 9400, 9400), 9400),
        ];
        for (flag, config, value) in cases {
            let error = config.validate().unwrap_err();
            assert!(
                matches!(error, Error::StudioPortCollides { port, other } if port == value && other == flag),
                "case {flag}: {error:?}"
            );
            let text = error.to_string();
            assert!(
                text.contains("--studio-port") && text.contains(flag),
                "case {flag}: {text}"
            );
        }
    }

    #[test]
    fn validate_three_different_ports_is_ok() {
        assert!(ports(8400, 9400, 8296).validate().is_ok());
    }
}
