fn start(port: &str) {
    let _ = std::process::Command::new("docker")
        .args(["run", "-d", "--network", "none", "aws-emulator", "-p", port])
        .status();
    let _ = ["-t", "off"];
}
