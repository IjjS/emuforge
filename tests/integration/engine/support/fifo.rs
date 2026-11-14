//! Named pipes (FIFOs) as decoy credential files: a FIFO holds one byte the check wrote into it, so the check can
//! tell afterwards whether any other process opened it for reading and drained it, and whether any process still
//! holds it open for reading. A blocking open or read by the engine would stall the request instead.
//!
//! No `libc` in this package and no `unsafe`: `mkfifo(1)` creates the pipe and `O_NONBLOCK` is passed through
//! `OpenOptionsExt::custom_flags` with the platform's value.

use std::fs::{File, OpenOptions};
use std::io::{self, Read, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::support::check::Env;

#[cfg(target_os = "macos")]
const O_NONBLOCK: i32 = 0x0004;
#[cfg(target_os = "linux")]
const O_NONBLOCK: i32 = 0o4000;

/// `errno` of an open for writing with `O_NONBLOCK` on a FIFO no process holds open for reading (6 on macOS and
/// Linux).
pub const ENXIO: i32 = 6;

/// The byte the check writes into every FIFO.
const PROBE: u8 = b'E';

/// A FIFO whose write end the check holds open, with one byte in it, and with no reader left open by the check.
pub struct HeldFifo {
    pub path: PathBuf,
    writer: Option<File>,
}

impl HeldFifo {
    /// Creates a FIFO at `path`, opens a reader (`O_NONBLOCK`, so it does not wait for a writer), opens the write
    /// end, writes one byte, and closes the reader. The write end stays open until `close` or drop.
    pub fn create(path: &Path) -> Result<HeldFifo, Env> {
        let made = Command::new("mkfifo")
            .arg(path)
            .status()
            .map_err(|e| Env::new(format!("cannot run mkfifo: {e}")))?;
        if !made.success() {
            return Err(Env::new(format!("mkfifo {} failed", path.display())));
        }
        let env = |what: &str, e: io::Error| Env::new(format!("{what} {}: {e}", path.display()));
        let reader = open_read_nonblocking(path).map_err(|e| env("cannot open for reading", e))?;
        let mut writer = OpenOptions::new()
            .write(true)
            .open(path)
            .map_err(|e| env("cannot open for writing", e))?;
        writer
            .write_all(&[PROBE])
            .map_err(|e| env("cannot write the probe byte into", e))?;
        drop(reader);
        Ok(HeldFifo {
            path: path.to_path_buf(),
            writer: Some(writer),
        })
    }

    /// Opens the FIFO for reading with `O_NONBLOCK` and reads what is in it: `Some(byte)` when the probe byte is
    /// still there, `None` when the pipe is empty (someone else read it).
    pub fn read_back(&self) -> io::Result<Option<u8>> {
        let mut reader = open_read_nonblocking(&self.path)?;
        let mut byte = [0u8; 1];
        match reader.read(&mut byte) {
            Ok(1) => Ok(Some(byte[0])),
            Ok(_) => Ok(None),
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// The byte `create` wrote.
    pub fn probe() -> u8 {
        PROBE
    }

    /// Closes the check's write end.
    pub fn close(&mut self) {
        self.writer.take();
    }
}

fn open_read_nonblocking(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .custom_flags(O_NONBLOCK)
        .open(path)
}

/// Opens `path` for writing with `O_NONBLOCK`: `Err` with `ENXIO` when no process holds it open for reading.
pub fn open_write_nonblocking(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .write(true)
        .custom_flags(O_NONBLOCK)
        .open(path)
}
