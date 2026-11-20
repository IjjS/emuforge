use std::fs;
use std::path::Path;
use std::process::{Command, Output};

const VALIDATOR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../infra/aws-emulator/compose-db-range.sh"
);
const CHILD_ARGS: [&str; 3] = ["--listen-address", "value with spaces", ""];

fn launch(workdir: &Path, bounds: [&str; 2], fixed_ports: &[(&str, &str)]) -> Output {
    let child = workdir.join("child.sh");
    fs::write(
        &child,
        "record=$1\nshift\nprintf '%s\\n' \"$@\" > \"$record\"\n",
    )
    .unwrap();
    let mut command = Command::new("sh");
    command.arg(VALIDATOR).args(bounds);
    for (name, port) in fixed_ports {
        command.args([name, port]);
    }
    command
        .args(["--", "sh"])
        .arg(child)
        .arg(workdir.join("received"))
        .args(CHILD_ARGS)
        .output()
        .unwrap()
}

fn assert_child_received_args(workdir: &Path, output: &Output) {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let received = fs::read_to_string(workdir.join("received")).unwrap();
    assert_eq!(received.lines().collect::<Vec<_>>(), CHILD_ARGS);
}

fn assert_child_blocked(workdir: &Path, output: &Output, diagnostic: &str) {
    assert!(!output.status.success(), "{diagnostic}");
    assert!(!workdir.join("received").exists(), "{diagnostic}");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.starts_with("Compose database port configuration: ") && stderr.contains(diagnostic),
        "{diagnostic}: {stderr}"
    );
}

#[test]
fn compose_db_range_forwards_command_arguments() {
    let workdir = tempfile::tempdir().unwrap();
    let output = launch(
        workdir.path(),
        ["28000", "28255"],
        &[
            ("EMULATOR_PORT", "9297"),
            ("EMUFORGE_ENGINE_PORT", "8297"),
            ("EMUFORGE_STUDIO_PORT", "8296"),
        ],
    );
    assert_child_received_args(workdir.path(), &output);
}

#[test]
fn compose_db_range_checks_decimal_unprivileged_bounds() {
    for (bounds, diagnostic) in [
        (["0x1000", "28255"], "EMUFORGE_DB_PORT_MIN='0x1000'"),
        (["28000", "28 255"], "EMUFORGE_DB_PORT_MAX='28 255'"),
        (["020000", "020255"], "EMUFORGE_DB_PORT_MIN='020000'"),
        (["1024", "020255"], "EMUFORGE_DB_PORT_MAX='020255'"),
        (["1023", "28255"], "EMUFORGE_DB_PORT_MIN='1023'"),
        (["28255", "28000"], "range 28255-28000"),
        (["28000", "65536"], "EMUFORGE_DB_PORT_MAX='65536'"),
        (
            ["999999999999999999999", "65535"],
            "EMUFORGE_DB_PORT_MIN='999999999999999999999'",
        ),
    ] {
        let workdir = tempfile::tempdir().unwrap();
        let output = launch(workdir.path(), bounds, &[]);
        assert_child_blocked(workdir.path(), &output, diagnostic);
    }

    let workdir = tempfile::tempdir().unwrap();
    let output = launch(
        workdir.path(),
        ["1024", "65535"],
        &[("EMULATOR_PORT", "1023")],
    );
    assert_child_received_args(workdir.path(), &output);
}

#[test]
fn compose_db_range_rejects_fixed_ports_at_and_between_bounds() {
    let bounds = ["28000", "28255"];
    for name in [
        "EMULATOR_PORT",
        "EMUFORGE_ENGINE_PORT",
        "EMUFORGE_STUDIO_PORT",
    ] {
        for port in ["28000", "28100", "28255"] {
            let workdir = tempfile::tempdir().unwrap();
            let output = launch(workdir.path(), bounds, &[(name, port)]);
            assert_child_blocked(
                workdir.path(),
                &output,
                &format!("{name}={port} conflicts with database port range 28000-28255"),
            );
        }
    }

    let workdir = tempfile::tempdir().unwrap();
    let output = launch(
        workdir.path(),
        bounds,
        &[
            ("EMULATOR_PORT", "27999"),
            ("EMUFORGE_ENGINE_PORT", "28256"),
        ],
    );
    assert_child_received_args(workdir.path(), &output);
}
