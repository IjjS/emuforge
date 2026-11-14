//! What `lsof` reports about a process's TCP sockets.

use std::process::Command;

use crate::support::check::Env;

fn lsof(args: &[&str]) -> Result<String, Env> {
    let output = Command::new("lsof")
        .args(args)
        .output()
        .map_err(|e| Env::new(format!("cannot run lsof: {e}")))?;
    // lsof exits 1 when nothing matches; an error message on stderr means it could not look.
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() && !stderr.trim().is_empty() {
        return Err(Env::new(format!(
            "lsof {}: {}",
            args.join(" "),
            stderr.trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// The remote address (`host:port` as lsof prints it with `-nP`) of every connected TCP socket of `pid`, from
/// `lsof -nP -a -p <pid> -iTCP`. Listening sockets have no remote address and are not listed.
pub fn tcp_remotes(pid: u32) -> Result<Vec<String>, Env> {
    let pid = pid.to_string();
    let text = lsof(&["-nP", "-a", "-p", &pid, "-iTCP"])?;
    Ok(text
        .lines()
        .skip(1)
        .filter_map(|line| {
            let name = line.split_whitespace().find(|w| w.contains("->"))?;
            Some(name.split_once("->")?.1.to_owned())
        })
        .collect())
}

/// The pids listening on TCP `127.0.0.1:<port>`, from `lsof -nP -t -iTCP@127.0.0.1:<port> -sTCP:LISTEN`.
pub fn listening_pids(port: u16) -> Result<Vec<u32>, Env> {
    let addr = format!("-iTCP@127.0.0.1:{port}");
    let text = lsof(&["-nP", "-t", &addr, "-sTCP:LISTEN"])?;
    Ok(text
        .lines()
        .filter_map(|l| l.trim().parse::<u32>().ok())
        .collect())
}
