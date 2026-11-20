#![cfg(test)]

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::num::NonZeroU16;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use clap::error::ErrorKind;
use clap::{Args, FromArgMatches};
use emuforge_core::{SETTINGS_FILE, Store};
use emuforge_server::{
    AllowHosts, Bound, Config, DEFAULT_ENGINE_PORT, Error, Form, LISTEN_IP, StudioFiles,
    allow_host_warning, engine_addr, listen_warning, seed_settings, serve, serve_bound,
    settings_dir, settings_step, studio_addr,
};

/// `Config` augmented onto a command, as a binary flattens it.
fn command() -> clap::Command {
    Config::augment_args(clap::Command::new("emuforge-server"))
}

fn parse(args: &[&str]) -> Result<Config, clap::Error> {
    let matches = command()
        .try_get_matches_from(std::iter::once("emuforge-server").chain(args.iter().copied()))?;
    Config::from_arg_matches(&matches)
}

fn port(value: u16) -> NonZeroU16 {
    NonZeroU16::new(value).unwrap()
}

#[test]
fn config_parses_both_ports() {
    let config = parse(&["--port", "8400", "--emulator-port", "9400"]).unwrap();
    assert_eq!(config.port, port(8400));
    assert_eq!(config.emulator_port, port(9400));
}

#[test]
fn config_accepts_lowest_and_highest_ports() {
    let cases = [
        (
            "--port 1",
            ["--port", "1", "--emulator-port", "9400"],
            1,
            9400,
        ),
        (
            "--port 65535",
            ["--port", "65535", "--emulator-port", "9400"],
            65535,
            9400,
        ),
        (
            "--emulator-port 1",
            ["--port", "8400", "--emulator-port", "1"],
            8400,
            1,
        ),
        (
            "--emulator-port 65535",
            ["--port", "8400", "--emulator-port", "65535"],
            8400,
            65535,
        ),
    ];
    for (name, args, engine, emulator) in cases {
        let config = parse(&args).unwrap_or_else(|error| panic!("case {name}: {error}"));
        assert_eq!(
            (config.port, config.emulator_port),
            (port(engine), port(emulator)),
            "case {name}"
        );
    }
}

#[test]
fn config_rejects_bad_port_naming_the_flag() {
    for value in ["0", "65536", "abc"] {
        let cases = [
            ("--port", ["--port", value, "--emulator-port", "9400"]),
            (
                "--emulator-port",
                ["--port", "8400", "--emulator-port", value],
            ),
        ];
        for (flag, args) in cases {
            let error = parse(&args).unwrap_err();
            let text = error.to_string();
            assert_eq!(
                error.kind(),
                ErrorKind::ValueValidation,
                "case {flag} {value}: {text}"
            );
            assert!(
                text.contains(&format!("'{flag} ")),
                "case {flag} {value}: {text}"
            );
        }
    }
}

#[test]
fn config_rejects_an_address_flag_as_unknown() {
    for flag in ["--bind", "--host"] {
        let error =
            parse(&["--port", "8400", "--emulator-port", "9400", flag, "0.0.0.0"]).unwrap_err();
        assert_eq!(
            error.kind(),
            ErrorKind::UnknownArgument,
            "case {flag}: {error}"
        );
    }
}

#[test]
fn config_help_shows_defaults_and_variables() {
    let help = command().render_help().to_string();
    let line = |flag: &str| {
        help.lines()
            .find(|line| line.trim_start().starts_with(flag))
            .unwrap_or_else(|| panic!("no help line for {flag}: {help}"))
            .to_owned()
    };
    let engine = line("--port ");
    assert!(engine.contains("[default: 8297]"), "{engine}");
    assert!(engine.contains("EMUFORGE_ENGINE_PORT"), "{engine}");
    let emulator = line("--emulator-port ");
    assert!(emulator.contains("[default: 9297]"), "{emulator}");
    assert!(emulator.contains("EMULATOR_PORT"), "{emulator}");
}

#[test]
fn config_validate_same_ports_is_same_port_naming_both_flags() {
    let config = parse(&["--port", "9400", "--emulator-port", "9400"]).unwrap();
    let error = config.validate().unwrap_err();
    assert!(matches!(error, Error::SamePort { port: 9400 }), "{error:?}");
    let text = error.to_string();
    assert!(
        text.contains("--port") && text.contains("--emulator-port"),
        "{text}"
    );
}

#[test]
fn config_validate_different_ports_is_ok() {
    let config = parse(&["--port", "8400", "--emulator-port", "9400"]).unwrap();
    assert!(config.validate().is_ok());
}

#[test]
fn listen_addr_is_loopback_with_the_engine_port() {
    for (name, value) in [("lowest", 1), ("default", 8297), ("highest", 65535)] {
        let config = Config {
            port: port(value),
            emulator_port: port(9400),
            studio_port: port(8296),
            listen_address: IpAddr::V4(LISTEN_IP),
            settings_dir: None,
            form: Form::Native,
            allow_hosts: AllowHosts::default(),
        };
        assert_eq!(
            engine_addr(&config),
            SocketAddr::new(Ipv4Addr::LOCALHOST.into(), value),
            "case {name}"
        );
    }
}

fn address(text: &str) -> IpAddr {
    text.parse().unwrap()
}

fn config_at(listen_address: IpAddr) -> Config {
    Config {
        port: port(8400),
        emulator_port: port(9400),
        studio_port: port(8396),
        listen_address,
        settings_dir: None,
        form: Form::Native,
        allow_hosts: AllowHosts::default(),
    }
}

#[test]
fn listen_address_absent_is_127_0_0_1() {
    assert_eq!(parse(&[]).unwrap().listen_address, address("127.0.0.1"));
}

#[test]
fn listen_address_ip_is_that_address() {
    for value in ["0.0.0.0", "192.0.2.1", "::1"] {
        let config = parse(&["--listen-address", value])
            .unwrap_or_else(|error| panic!("case {value}: {error}"));
        assert_eq!(config.listen_address, address(value), "case {value}");
    }
}

#[test]
fn listen_address_not_an_ip_is_a_usage_error_naming_the_flag() {
    for (name, value) in [
        ("localhost", "localhost"),
        ("example.com", "example.com"),
        ("with a port", "0.0.0.0:80"),
        ("empty", ""),
    ] {
        let error = parse(&["--listen-address", value]).unwrap_err();
        let text = error.to_string();
        assert_eq!(
            error.kind(),
            ErrorKind::ValueValidation,
            "case {name}: {text}"
        );
        assert!(text.contains("--listen-address"), "case {name}: {text}");
    }
}

/// Set in the child process of `listen_address_variable_without_the_flag_is_127_0_0_1`.
const CHILD_MARKER: &str = "EMUFORGE_TEST_LISTEN_ADDRESS_CHILD";
const CHILD_TEST: &str = "listen_address_parsed_in_the_child_process_is_printed";

/// Runs only as the child process of the test below, whose environment it has; elsewhere it does nothing.
#[test]
fn listen_address_parsed_in_the_child_process_is_printed() {
    if std::env::var_os(CHILD_MARKER).is_none() {
        return;
    }
    let config = parse(&[]).unwrap();
    println!("listen_address={}", config.listen_address);
}

/// The process environment cannot be changed from a test (`set_var` is unsafe), so this test runs its own
/// binary again, for the one test above, with `EMUFORGE_LISTEN_ADDRESS` set.
#[test]
fn listen_address_variable_without_the_flag_is_127_0_0_1() {
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([CHILD_TEST, "--exact", "--nocapture", "--test-threads=1"])
        .env(CHILD_MARKER, "1")
        .env("EMUFORGE_LISTEN_ADDRESS", "0.0.0.0")
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(output.status.success(), "{stdout}");
    assert!(stdout.contains("listen_address=127.0.0.1\n"), "{stdout}");
}

#[test]
fn config_help_shows_listen_address_default_without_a_variable() {
    let help = command().render_help().to_string();
    let line = help
        .lines()
        .find(|line| line.trim_start().starts_with("--listen-address "))
        .unwrap_or_else(|| panic!("no help line for --listen-address: {help}"));
    assert!(line.contains("[default: 127.0.0.1]"), "{line}");
    assert!(!line.contains("env:"), "{line}");
    assert!(!help.contains("always on 127.0.0.1"), "{help}");
}

#[test]
fn config_validate_same_ports_names_both_flags_both_variables_and_the_number() {
    let error = parse(&["--port", "9400", "--emulator-port", "9400"])
        .unwrap()
        .validate()
        .unwrap_err();
    assert!(matches!(error, Error::SamePort { port: 9400 }), "{error:?}");
    let text = error.to_string();
    for part in [
        "--port",
        "EMUFORGE_ENGINE_PORT",
        "--emulator-port",
        "EMULATOR_PORT",
        "9400",
    ] {
        assert!(text.contains(part), "{part}: {text}");
    }
}

#[test]
fn config_validate_studio_port_collision_names_both_flags_both_variables_and_the_number() {
    let cases = [
        (
            "--port",
            [
                "--port",
                "8400",
                "--emulator-port",
                "9400",
                "--studio-port",
                "8400",
            ],
            "EMUFORGE_ENGINE_PORT",
            "8400",
        ),
        (
            "--emulator-port",
            [
                "--port",
                "8400",
                "--emulator-port",
                "9400",
                "--studio-port",
                "9400",
            ],
            "EMULATOR_PORT",
            "9400",
        ),
    ];
    for (name, args, variable, number) in cases {
        let error = parse(&args).unwrap().validate().unwrap_err();
        assert!(
            matches!(error, Error::StudioPortCollides { .. }),
            "case {name}: {error:?}"
        );
        let text = error.to_string();
        for part in [
            "--studio-port",
            "EMUFORGE_STUDIO_PORT",
            name,
            variable,
            number,
        ] {
            assert!(text.contains(part), "case {name}, {part}: {text}");
        }
    }
}

#[test]
fn listen_warning_loopback_is_none() {
    assert_eq!(listen_warning(address("127.0.0.1")), None);
}

#[test]
fn listen_warning_other_address_names_it_and_the_flag() {
    for value in ["0.0.0.0", "192.0.2.1", "::1"] {
        let warning =
            listen_warning(address(value)).unwrap_or_else(|| panic!("case {value}: no warning"));
        for part in [value, "not on loopback", "--listen-address"] {
            assert!(warning.contains(part), "case {value}, {part}: {warning}");
        }
    }
}

#[test]
fn engine_and_studio_addr_take_the_listen_address() {
    let config = config_at(address("0.0.0.0"));
    assert_eq!(engine_addr(&config), "0.0.0.0:8400".parse().unwrap());
    assert_eq!(studio_addr(&config), "0.0.0.0:8396".parse().unwrap());
}

#[test]
fn bind_error_names_the_address_the_os_error_and_the_listeners_flag_and_variable() {
    let addr: SocketAddr = "0.0.0.0:8400".parse().unwrap();
    let os_error = || std::io::Error::new(std::io::ErrorKind::AddrInUse, "Address already in use");
    let cases = [
        (
            "engine",
            Error::engine_bind(addr, os_error()),
            "--port",
            "EMUFORGE_ENGINE_PORT",
        ),
        (
            "studio",
            Error::studio_bind(addr, os_error()),
            "--studio-port",
            "EMUFORGE_STUDIO_PORT",
        ),
    ];
    for (name, error, flag, variable) in cases {
        let text = error.to_string();
        for part in ["0.0.0.0:8400", "Address already in use", flag, variable] {
            assert!(text.contains(part), "case {name}, {part}: {text}");
        }
    }
}

// ---- Issue 485: the settings folder, the form and the settings step of `serve` ----

/// `Config` with every environment binding removed, so the process environment plays no part.
fn parse_without_environment(args: &[&str]) -> Result<Config, clap::Error> {
    let command = [
        "port",
        "emulator_port",
        "studio_port",
        "settings_dir",
        "form",
        "allow_hosts",
    ]
    .into_iter()
    .fold(command(), |command, id| {
        command.mut_arg(id, |arg| arg.env(None))
    });
    let matches = command
        .try_get_matches_from(std::iter::once("emuforge-server").chain(args.iter().copied()))?;
    Config::from_arg_matches(&matches)
}

#[test]
fn settings_dir_and_form_absent_are_no_folder_and_native() {
    let config = parse_without_environment(&[]).unwrap();
    assert_eq!(config.settings_dir, None);
    assert_eq!(config.form, Form::Native);
}

#[test]
fn form_compose_flag_is_compose_and_another_value_is_a_usage_error_naming_the_flag() {
    let config = parse_without_environment(&["--form", "compose"]).unwrap();
    assert_eq!(config.form, Form::Compose);
    let config = parse_without_environment(&["--form", "native"]).unwrap();
    assert_eq!(config.form, Form::Native);
    let error = parse_without_environment(&["--form", "other"]).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidValue, "{error}");
    assert!(error.to_string().contains("--form"), "{error}");
}

#[test]
fn settings_dir_flag_is_that_folder() {
    let config = parse_without_environment(&["--settings-dir", "/x"]).unwrap();
    assert_eq!(config.settings_dir, Some(PathBuf::from("/x")));
}

/// Set in the child process of the variable tests below.
const SETTINGS_CHILD_MARKER: &str = "EMUFORGE_TEST_SETTINGS_CHILD";
const SETTINGS_CHILD_TEST: &str = "settings_parsed_in_the_child_process_are_printed";

/// Runs only as the child process of the tests below, whose environment it has; elsewhere it does nothing.
#[test]
fn settings_parsed_in_the_child_process_are_printed() {
    let Some(args) = std::env::var_os(SETTINGS_CHILD_MARKER) else {
        return;
    };
    let args = args.into_string().unwrap();
    let args: Vec<&str> = args.split_whitespace().collect();
    let config = parse(&args).unwrap();
    println!(
        "form={} settings_dir={:?}",
        config.form,
        config
            .settings_dir
            .as_deref()
            .map(Path::display)
            .map(|d| d.to_string())
    );
}

/// Runs this test binary again for the one test above, with `variables` set and `args` given to it.
fn parsed_in_a_child(variables: &[(&str, &str)], args: &str) -> String {
    let mut command = std::process::Command::new(std::env::current_exe().unwrap());
    command
        .args([
            SETTINGS_CHILD_TEST,
            "--exact",
            "--nocapture",
            "--test-threads=1",
        ])
        .env(SETTINGS_CHILD_MARKER, args)
        .env_remove("EMUFORGE_FORM")
        .env_remove("EMUFORGE_SETTINGS_DIR");
    for (name, value) in variables {
        command.env(name, value);
    }
    let output = command.output().unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    assert!(output.status.success(), "{stdout}");
    stdout
}

#[test]
fn form_variable_compose_is_compose() {
    let stdout = parsed_in_a_child(&[("EMUFORGE_FORM", "compose")], " ");
    assert!(stdout.contains("form=compose "), "{stdout}");
}

#[test]
fn settings_dir_variable_is_that_folder_and_the_flag_wins_over_it() {
    let stdout = parsed_in_a_child(&[("EMUFORGE_SETTINGS_DIR", "/x")], " ");
    assert!(stdout.contains("settings_dir=Some(\"/x\")"), "{stdout}");
    let stdout = parsed_in_a_child(&[("EMUFORGE_SETTINGS_DIR", "/x")], "--settings-dir /y");
    assert!(stdout.contains("settings_dir=Some(\"/y\")"), "{stdout}");
}

#[test]
fn help_lists_settings_dir_and_form_with_their_variables_and_emulator_port_as_the_port_of_local() {
    let help = command().render_help().to_string();
    let entry = |flag: &str| {
        let start = help
            .find(&format!("      {flag} "))
            .unwrap_or_else(|| panic!("no entry for {flag}: {help}"));
        help[start..]
            .split("\n      --")
            .next()
            .unwrap_or_default()
            .to_owned()
    };
    let settings = entry("--settings-dir");
    assert!(
        settings.contains("[env: EMUFORGE_SETTINGS_DIR="),
        "{settings}"
    );
    let form = entry("--form");
    assert!(form.contains("[env: EMUFORGE_FORM="), "{form}");
    assert!(
        form.contains("native") && form.contains("compose"),
        "{form}"
    );
    let emulator = entry("--emulator-port");
    assert!(
        emulator.contains("local") && emulator.contains("settings file is absent"),
        "{emulator}"
    );
}

fn with(form: Form, settings: Option<&str>) -> Config {
    Config {
        settings_dir: settings.map(PathBuf::from),
        form,
        ..config_at(IpAddr::V4(LISTEN_IP))
    }
}

#[test]
fn settings_folder_without_the_flag_is_the_forms_folder_under_home() {
    let home = Path::new("/home/u");
    let cwd = Path::new("/work");
    assert_eq!(
        settings_dir(&with(Form::Native, None), home, cwd).unwrap(),
        PathBuf::from("/home/u/.config/emuforge")
    );
    assert_eq!(
        settings_dir(&with(Form::Compose, None), home, cwd).unwrap(),
        PathBuf::from("/home/u/.config/emuforge-compose")
    );
}

#[test]
fn settings_folder_at_or_under_aws_is_refused_naming_the_flag_and_aws() {
    let home = Path::new("/home/u");
    let cases = [
        ("~/.aws", "/home/u/.aws", "/work"),
        ("~/.aws/x", "/home/u/.aws/x", "/work"),
        ("~/.aws/", "/home/u/.aws/", "/work"),
        ("relative under ~/.aws", "../.aws/emulator", "/home/u/work"),
        ("relative with dot", "./.aws", "/home/u"),
        ("through ..", "/home/u/x/../.aws/y", "/work"),
    ];
    for (name, dir, cwd) in cases {
        for form in [Form::Native, Form::Compose] {
            let error = settings_dir(&with(form, Some(dir)), home, Path::new(cwd)).unwrap_err();
            assert!(
                matches!(error, Error::SettingsDirUnderAws { .. }),
                "case {name}: {error:?}"
            );
            let text = error.to_string();
            assert!(
                text.contains("--settings-dir") && text.contains("~/.aws"),
                "case {name}: {text}"
            );
        }
    }
}

#[test]
fn settings_folder_beside_aws_or_relative_elsewhere_is_accepted_and_made_absolute() {
    let home = Path::new("/home/u");
    let cases = [
        ("~/.awsx", "/home/u/.awsx", "/work", "/home/u/.awsx"),
        ("relative", "s", "/work", "/work/s"),
        ("relative with ..", "../s", "/work/a", "/work/s"),
    ];
    for (name, dir, cwd, expected) in cases {
        let resolved = settings_dir(&with(Form::Native, Some(dir)), home, Path::new(cwd))
            .unwrap_or_else(|error| panic!("case {name}: {error}"));
        assert_eq!(resolved, PathBuf::from(expected), "case {name}");
    }
}

/// The lines of every `tracing` event captured so far, and the signal each write gives a waiting test.
#[derive(Clone)]
struct Lines {
    bytes: Arc<Mutex<Vec<u8>>>,
    written: Arc<tokio::sync::Notify>,
}

impl std::io::Write for Lines {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.bytes.lock().unwrap().extend_from_slice(bytes);
        self.written.notify_waiters();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// How long a test waits for a line it asserts: a slow runner logs a line some time after its port accepts.
const LINE_BOUND: Duration = Duration::from_secs(10);

impl Lines {
    fn new() -> Self {
        Self {
            bytes: Arc::new(Mutex::new(Vec::new())),
            written: Arc::new(tokio::sync::Notify::new()),
        }
    }

    fn text(&self) -> String {
        String::from_utf8(self.bytes.lock().unwrap().clone()).unwrap()
    }

    /// Returns once the captured lines hold `text`, woken by each write; panics with them when `bound` passes
    /// first.
    async fn logged_within(&self, text: &str, bound: Duration) {
        let found = tokio::time::timeout(bound, async {
            loop {
                // Made before the check, so a write between the check and the await still wakes it.
                let woken = self.written.notified();
                if self.text().contains(text) {
                    break;
                }
                woken.await;
            }
        })
        .await;
        assert!(
            found.is_ok(),
            "{text:?} not logged within {bound:?}: {}",
            self.text()
        );
    }

    /// [`Lines::logged_within`] the [`LINE_BOUND`].
    async fn logged(&self, text: &str) {
        self.logged_within(text, LINE_BOUND).await;
    }
}

/// The lines of every `tracing` event while `run` runs, the subscriber set on this thread only.
async fn captured<F: std::future::Future<Output = ()>>(run: F) -> String {
    captured_with(|_| run).await
}

/// [`captured`], `run` given the lines so far, so it can wait for a line before the capture ends.
async fn captured_with<F, R>(run: R) -> String
where
    F: std::future::Future<Output = ()>,
    R: FnOnce(Lines) -> F,
{
    let lines = Lines::new();
    let writer = lines.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_writer(move || writer.clone())
        .with_ansi(false)
        .with_max_level(tracing::Level::TRACE)
        .finish();
    let guard = tracing::subscriber::set_default(subscriber);
    run(lines.clone()).await;
    drop(guard);
    lines.text()
}

#[tokio::test(flavor = "current_thread", start_paused = true)]
async fn a_line_logged_after_the_wait_starts_is_waited_for() {
    let log = captured_with(|lines| async move {
        tokio::join!(
            lines.logged_within("late line", Duration::from_secs(5)),
            async {
                tokio::time::sleep(Duration::from_millis(50)).await;
                tracing::info!("late line");
            }
        );
    })
    .await;
    assert!(log.contains("late line"), "{log}");
}

#[tokio::test(flavor = "current_thread", start_paused = true)]
#[should_panic(expected = "early line")]
async fn a_line_not_logged_within_the_bound_fails_with_the_log() {
    captured_with(|lines| async move {
        tracing::info!("early line");
        lines
            .logged_within("absent line", Duration::from_millis(50))
            .await;
    })
    .await;
}

const UNUSABLE: &str = "{not json";

fn store(dir: &Path, form: Form) -> (Store, emuforge_core::Settings) {
    let seed = seed_settings(form, port(9391));
    (Store::new(dir.to_owned(), seed.clone()), seed)
}

fn entries(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect()
}

/// No line names a key id, secret or session token: the step reads nothing of the emulator's files, so a
/// line holds none of their words.
fn assert_no_key(log: &str) {
    for word in [
        "AKIA",
        "ASIA",
        "secret",
        "Secret",
        "session_token",
        "token",
        "aws_access_key_id",
    ] {
        assert!(!log.contains(word), "a start line holds {word}: {log}");
    }
}

#[tokio::test(flavor = "current_thread")]
async fn native_start_with_the_file_absent_writes_nothing_and_names_the_file_form_and_local() {
    let dir = tempfile::tempdir().unwrap();
    let (store, seed) = store(dir.path(), Form::Native);
    let log = captured(settings_step(&store, Form::Native, &seed)).await;
    assert!(entries(dir.path()).is_empty(), "{:?}", entries(dir.path()));
    let lines: Vec<&str> = log.lines().filter(|line| line.contains("INFO")).collect();
    assert_eq!(lines.len(), 1, "{log}");
    let file = dir.path().join(SETTINGS_FILE);
    let line = lines[0];
    assert!(line.contains(&file.display().to_string()), "{line}");
    assert!(line.contains("form native"), "{line}");
    assert!(
        line.contains("active target local at https://127.0.0.1:9391"),
        "{line}"
    );
    assert_no_key(&log);
}

#[tokio::test(flavor = "current_thread")]
async fn native_start_with_an_unusable_file_goes_on_and_says_the_file_cannot_be_used() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join(SETTINGS_FILE);
    std::fs::write(&file, UNUSABLE).unwrap();
    let (store, seed) = store(dir.path(), Form::Native);
    let log = captured(settings_step(&store, Form::Native, &seed)).await;
    assert!(log.contains("cannot be used"), "{log}");
    assert!(log.contains(&file.display().to_string()), "{log}");
    assert_eq!(std::fs::read_to_string(&file).unwrap(), UNUSABLE);
    assert_no_key(&log);
}

const COMPOSE_FILE: &str = r#"{
  "version": 1,
  "active": "compose",
  "targets": [
    {
      "name": "compose",
      "provider": "aws",
      "emulator": "aws-emulator",
      "endpoint": "https://127.0.0.1:9391",
      "credentials": "emulator-files",
      "tls": "emulator-ca"
    }
  ]
}
"#;

#[tokio::test(flavor = "current_thread")]
async fn compose_start_makes_the_file_hold_exactly_compose_and_says_it_was_written() {
    let other = r#"{"version":1,"active":"a","targets":[{"name":"a","endpoint":"https://127.0.0.2:9500"},{"name":"b","endpoint":"https://127.0.0.1:9600"}]}"#;
    let cases = [
        ("absent", None, "written"),
        ("other targets", Some(other), "replaced"),
        ("unusable", Some(UNUSABLE), "replaced"),
    ];
    for (name, before, said) in cases {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(SETTINGS_FILE);
        if let Some(before) = before {
            std::fs::write(&file, before).unwrap();
        }
        let (store, seed) = store(dir.path(), Form::Compose);
        let log = captured(settings_step(&store, Form::Compose, &seed)).await;
        assert_eq!(
            store.load().await.unwrap(),
            seed,
            "case {name}: the file does not hold exactly compose"
        );
        let written: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(
            written,
            serde_json::from_str::<serde_json::Value>(COMPOSE_FILE).unwrap(),
            "case {name}"
        );
        assert_eq!(entries(dir.path()), vec![SETTINGS_FILE], "case {name}");
        let line = log
            .lines()
            .find(|line| line.contains("INFO") && line.contains(said))
            .unwrap_or_else(|| panic!("case {name}: no line saying {said}: {log}"));
        assert!(
            line.contains(&file.display().to_string()),
            "case {name}: {line}"
        );
        assert!(
            log.contains("form compose, active target compose at https://127.0.0.1:9391"),
            "case {name}: {log}"
        );
        assert_no_key(&log);
    }
}

#[tokio::test(flavor = "current_thread")]
async fn compose_start_with_the_file_already_so_does_not_rewrite_it_and_says_nothing_of_writing() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join(SETTINGS_FILE);
    // The same settings in another layout: rewriting would change the bytes.
    let compact: String = COMPOSE_FILE.split_whitespace().collect();
    std::fs::write(&file, &compact).unwrap();
    let modified = std::fs::metadata(&file).unwrap().modified().unwrap();
    let (store, seed) = store(dir.path(), Form::Compose);
    let log = captured(settings_step(&store, Form::Compose, &seed)).await;
    assert_eq!(std::fs::read_to_string(&file).unwrap(), compact);
    assert_eq!(
        std::fs::metadata(&file).unwrap().modified().unwrap(),
        modified
    );
    assert!(
        !log.contains("written") && !log.contains("replaced"),
        "{log}"
    );
    assert!(
        log.contains("form compose, active target compose at https://127.0.0.1:9391"),
        "{log}"
    );
    assert_no_key(&log);
}

// ---- Issue 503: --allow-host and EMUFORGE_ALLOW_HOSTS ----

/// Set in the child process of the variable tests below.
const ALLOW_CHILD_MARKER: &str = "EMUFORGE_TEST_ALLOW_HOSTS_CHILD";
const ALLOW_CHILD_TEST: &str = "allow_hosts_parsed_in_the_child_process_are_printed";

/// Runs only as the child process of the tests below, whose environment it has; elsewhere it does nothing.
#[test]
fn allow_hosts_parsed_in_the_child_process_are_printed() {
    let Some(args) = std::env::var_os(ALLOW_CHILD_MARKER) else {
        return;
    };
    let args = args.into_string().unwrap();
    let args: Vec<&str> = args.split_whitespace().collect();
    match parse(&args) {
        Ok(config) => {
            let hosts: Vec<String> = config
                .allow_hosts
                .as_slice()
                .iter()
                .map(ToString::to_string)
                .collect();
            println!("allow_hosts=[{}]", hosts.join(" "));
        }
        Err(error) => println!("error kind={:?} text={error}", error.kind()),
    }
}

/// Runs this test binary again for the one test above, with `EMUFORGE_ALLOW_HOSTS` set to `variable` and `args`
/// given to it.
fn allow_hosts_in_a_child(variable: &str, args: &str) -> String {
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            ALLOW_CHILD_TEST,
            "--exact",
            "--nocapture",
            "--test-threads=1",
        ])
        .env(ALLOW_CHILD_MARKER, args)
        .env("EMUFORGE_ALLOW_HOSTS", variable)
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    assert!(output.status.success(), "{stdout}");
    stdout
}

#[test]
fn allow_hosts_variable_is_every_value() {
    let stdout = allow_hosts_in_a_child("a.test,b.test:9000", " ");
    assert!(
        stdout.contains("allow_hosts=[a.test b.test:9000]"),
        "{stdout}"
    );
}

#[test]
fn allow_hosts_variable_empty_is_no_name_and_no_error() {
    let stdout = allow_hosts_in_a_child("", " ");
    assert!(stdout.contains("allow_hosts=[]"), "{stdout}");
}

#[test]
fn allow_hosts_variable_with_an_empty_item_is_a_usage_error_naming_the_flag() {
    for value in ["a.test,,b.test", "a.test,"] {
        let stdout = allow_hosts_in_a_child(value, " ");
        assert!(
            stdout.contains("error kind=ValueValidation"),
            "case {value}: {stdout}"
        );
        assert!(stdout.contains("--allow-host"), "case {value}: {stdout}");
    }
}

#[test]
fn allow_hosts_flag_wins_over_the_variable() {
    let stdout = allow_hosts_in_a_child("a.test", "--allow-host b.test");
    assert!(stdout.contains("allow_hosts=[b.test]"), "{stdout}");
}

/// `N` loopback ports that nothing is to listen on: an emulator port with no emulator, or a Studio port that must
/// stay closed. Every listener is held until all are read, so the ports differ from each other and from any
/// listener the caller holds; none is for something bound later.
fn closed_ports<const N: usize>() -> [NonZeroU16; N] {
    let held: [std::net::TcpListener; N] =
        std::array::from_fn(|_| std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap());
    held.map(|listener| port(listener.local_addr().unwrap().port()))
}

/// The machine's first non-loopback IPv4 address, as the route to a documentation address picks it; `None` on a
/// machine with none. Connecting a UDP socket sends nothing.
fn non_loopback_ipv4() -> Option<Ipv4Addr> {
    let socket = std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() => Some(ip),
        _ => None,
    }
}

/// Whether a connection to `ip:port` is accepted, trying a bounded number of times while `serve` starts.
async fn accepts(ip: IpAddr, port: u16) -> bool {
    for _ in 0..1000 {
        if tokio::net::TcpStream::connect((ip, port)).await.is_ok() {
            return true;
        }
        tokio::task::yield_now().await;
    }
    false
}

/// `GET path` on `127.0.0.1:port` with that `Host`; the whole answer.
async fn get_raw(port: u16, path: &str) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut stream = tokio::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port))
        .await
        .unwrap();
    let request =
        format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut answer = Vec::new();
    stream.read_to_end(&mut answer).await.unwrap();
    String::from_utf8_lossy(&answer).into_owned()
}

/// A `Config` on loopback with the engine port `engine`, the settings folder under `dir`, the allowed name
/// `name.test`, and an emulator port and a Studio port that nothing listens on.
fn allowing_name_test(dir: &Path, engine: NonZeroU16) -> Config {
    let [emulator_port, studio_port] = closed_ports();
    Config {
        port: engine,
        emulator_port,
        studio_port,
        listen_address: IpAddr::V4(LISTEN_IP),
        settings_dir: Some(dir.join("settings")),
        form: Form::Native,
        allow_hosts: AllowHosts::from(vec!["name.test".parse().unwrap()]),
    }
}

/// [`allowing_name_test`] for [`Bound::bind_free`], which replaces the engine port with one it holds.
fn allowing_name_to_bind(dir: &Path) -> Config {
    allowing_name_test(dir, DEFAULT_ENGINE_PORT)
}

const NO_EFFECT: &str = "--allow-host (EMUFORGE_ALLOW_HOSTS) has no effect";

#[tokio::test(flavor = "current_thread")]
async fn serve_without_studio_and_an_allowed_name_warns_it_has_no_effect_and_serves_the_engine() {
    let dir = tempfile::tempdir().unwrap();
    let bound = Bound::bind_free(allowing_name_to_bind(dir.path()), None)
        .await
        .unwrap();
    let (engine, studio) = (bound.config().port.get(), bound.config().studio_port.get());
    let log = captured_with(|lines| async move {
        tokio::select! {
            ended = serve_bound(bound, dir.path().to_owned()) => panic!("serve ended: {ended:?}"),
            () = async {
                assert!(accepts(IpAddr::V4(LISTEN_IP), engine).await, "engine port");
                lines.logged(NO_EFFECT).await;
                let answer = get_raw(engine, "/__emuforge/health").await;
                assert!(answer.starts_with("HTTP/1.1 "), "{answer}");
                assert!(!answer.starts_with("HTTP/1.1 421"), "{answer}");
                assert!(
                    tokio::net::TcpStream::connect((Ipv4Addr::LOCALHOST, studio)).await.is_err(),
                    "something listens on the Studio port"
                );
            } => {}
        }
    })
    .await;
    assert_eq!(log.matches(NO_EFFECT).count(), 1, "{log}");
    assert!(log.contains(" WARN "), "{log}");
    assert!(!log.contains("also answers the host names"), "{log}");
}

#[tokio::test(flavor = "current_thread")]
async fn serve_with_studio_and_an_allowed_name_warns_and_binds_loopback_only() {
    let dir = tempfile::tempdir().unwrap();
    let files = StudioFiles::new([("index.html", &b"<p>studio</p>"[..])]).unwrap();
    let bound = Bound::bind_free(allowing_name_to_bind(dir.path()), Some(files))
        .await
        .unwrap();
    let config = bound.config();
    let (engine, studio) = (config.port.get(), config.studio_port.get());
    let warning = allow_host_warning(config.allow_hosts.as_slice(), config.studio_port).unwrap();
    let elsewhere = non_loopback_ipv4();
    let awaited = &warning;
    let log = captured_with(|lines| async move {
        tokio::select! {
            ended = serve_bound(bound, dir.path().to_owned()) => panic!("serve ended: {ended:?}"),
            () = async {
                for (name, port) in [("engine", engine), ("studio", studio)] {
                    assert!(accepts(IpAddr::V4(LISTEN_IP), port).await, "{name} on 127.0.0.1");
                    if let Some(ip) = elsewhere {
                        assert!(
                            tokio::net::TcpStream::connect((ip, port)).await.is_err(),
                            "{name} accepts on {ip}"
                        );
                    }
                }
                lines.logged(awaited).await;
                for port in [engine, studio] {
                    lines.logged(&format!("listen=127.0.0.1:{port}")).await;
                }
            } => {}
        }
    })
    .await;
    assert_eq!(log.matches(&warning).count(), 1, "{log}");
    assert!(!log.contains(NO_EFFECT), "{log}");
    for port in [engine, studio] {
        assert!(log.contains(&format!("listen=127.0.0.1:{port}")), "{log}");
    }
}

const INDEX: &[u8] = b"<p>studio</p>";

fn studio_files() -> StudioFiles {
    StudioFiles::new([("index.html", INDEX)]).unwrap()
}

/// Whether binding `127.0.0.1:port` now fails with `AddrInUse`.
fn bind_is_refused_in_use(port: u16) -> bool {
    std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, port))
        .is_err_and(|error| error.kind() == std::io::ErrorKind::AddrInUse)
}

#[tokio::test(flavor = "current_thread")]
async fn bind_free_holds_the_engine_port_until_serve_bound_answers_on_it() {
    let dir = tempfile::tempdir().unwrap();
    let bound = Bound::bind_free(allowing_name_to_bind(dir.path()), None)
        .await
        .unwrap();
    let engine = bound.config().port.get();
    assert!(
        bind_is_refused_in_use(engine),
        "engine port {engine} was free before serve_bound"
    );
    tokio::select! {
        ended = serve_bound(bound, dir.path().to_owned()) => panic!("serve_bound ended: {ended:?}"),
        answer = get_raw(engine, "/__emuforge/health") => {
            assert!(answer.starts_with("HTTP/1.1 "), "{answer}");
        }
    }
}

#[tokio::test(flavor = "current_thread")]
async fn bind_free_with_studio_holds_the_studio_port_until_serve_bound_serves_index_on_it() {
    let dir = tempfile::tempdir().unwrap();
    let bound = Bound::bind_free(allowing_name_to_bind(dir.path()), Some(studio_files()))
        .await
        .unwrap();
    let studio = bound.config().studio_port.get();
    assert!(
        bind_is_refused_in_use(studio),
        "studio port {studio} was free before serve_bound"
    );
    tokio::select! {
        ended = serve_bound(bound, dir.path().to_owned()) => panic!("serve_bound ended: {ended:?}"),
        answer = get_raw(studio, "/") => {
            assert!(answer.starts_with("HTTP/1.1 200"), "{answer}");
            assert!(answer.ends_with(std::str::from_utf8(INDEX).unwrap()), "{answer}");
        }
    }
}

#[tokio::test(flavor = "current_thread")]
async fn bind_free_with_studio_gives_three_different_ports_and_a_valid_config() {
    let dir = tempfile::tempdir().unwrap();
    let given = allowing_name_to_bind(dir.path());
    let bound = Bound::bind_free(given.clone(), Some(studio_files()))
        .await
        .unwrap();
    let config = bound.config();
    let ports = [config.port, config.studio_port, config.emulator_port];
    assert!(
        ports[0] != ports[1] && ports[1] != ports[2] && ports[0] != ports[2],
        "{ports:?}"
    );
    assert_eq!(config.emulator_port, given.emulator_port);
    config.validate().unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn bind_free_without_studio_keeps_the_engine_off_the_given_ports_and_a_valid_config() {
    let dir = tempfile::tempdir().unwrap();
    let given = allowing_name_to_bind(dir.path());
    let bound = Bound::bind_free(given.clone(), None).await.unwrap();
    let config = bound.config();
    assert_ne!(config.port, config.emulator_port);
    assert_ne!(config.port, config.studio_port);
    assert_eq!(
        (config.emulator_port, config.studio_port),
        (given.emulator_port, given.studio_port)
    );
    config.validate().unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn bind_free_twice_held_shares_no_listener_port() {
    let dir = tempfile::tempdir().unwrap();
    let listener_ports = |bound: &Bound| [bound.config().port, bound.config().studio_port];
    let cases = [("without Studio", false), ("with Studio", true)];
    for (name, with_studio) in cases {
        let files = || with_studio.then(studio_files);
        let first = Bound::bind_free(allowing_name_to_bind(dir.path()), files())
            .await
            .unwrap();
        let second = Bound::bind_free(allowing_name_to_bind(dir.path()), files())
            .await
            .unwrap();
        let (first_ports, second_ports) = if with_studio {
            (
                listener_ports(&first).to_vec(),
                listener_ports(&second).to_vec(),
            )
        } else {
            (vec![first.config().port], vec![second.config().port])
        };
        assert!(
            first_ports.iter().all(|port| !second_ports.contains(port)),
            "case {name}: {first_ports:?} and {second_ports:?}"
        );
    }
}

#[tokio::test(flavor = "current_thread")]
async fn serve_bound_with_settings_under_aws_is_refused_before_the_engine_listens() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = allowing_name_to_bind(dir.path());
    config.settings_dir = Some(dir.path().join(".aws/emuforge"));
    let bound = Bound::bind_free(config, None).await.unwrap();
    let mut ended = None;
    let log = captured(async {
        ended = Some(serve_bound(bound, dir.path().to_owned()).await);
    })
    .await;
    let ended = ended.unwrap();
    assert!(
        matches!(ended, Err(Error::SettingsDirUnderAws { .. })),
        "{ended:?}"
    );
    assert!(!log.contains("engine listening"), "{log}");
}

/// A listener of the test's own on a loopback port, held, and a `Config` whose engine port is that port, with its
/// emulator port and Studio port picked while the listener is held.
fn config_on_a_held_engine_port(dir: &Path) -> (std::net::TcpListener, Config) {
    let held = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let engine = port(held.local_addr().unwrap().port());
    (held, allowing_name_test(dir, engine))
}

#[tokio::test(flavor = "current_thread")]
async fn serve_on_a_held_engine_port_fails_to_bind_naming_the_flag_and_variable() {
    let dir = tempfile::tempdir().unwrap();
    let (_held, config) = config_on_a_held_engine_port(dir.path());
    let at = engine_addr(&config);
    match serve(config, dir.path().to_owned(), None).await {
        Err(Error::Bind {
            addr,
            flag,
            variable,
            ..
        }) => assert_eq!(
            (addr, flag, variable),
            (at, "--port", "EMUFORGE_ENGINE_PORT")
        ),
        other => panic!("{other:?}"),
    }
}

#[tokio::test(flavor = "current_thread")]
async fn serve_on_a_held_engine_port_with_settings_under_aws_refuses_the_folder_before_binding() {
    let dir = tempfile::tempdir().unwrap();
    let (_held, mut config) = config_on_a_held_engine_port(dir.path());
    config.settings_dir = Some(dir.path().join(".aws/emuforge"));
    let ended = serve(config, dir.path().to_owned(), None).await;
    assert!(
        matches!(ended, Err(Error::SettingsDirUnderAws { .. })),
        "{ended:?}"
    );
}
