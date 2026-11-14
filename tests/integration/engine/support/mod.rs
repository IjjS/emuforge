//! Helpers shared by the engine integration checks. Each file under `tests/` includes this module with
//! `#[path = "../support/mod.rs"] mod support;`.
//!
//! The check contract is in `check.rs`. Everything a check starts (engines, emulators, listeners, temporary
//! directories) is owned by a guard that cleans up on drop, so a failed assertion leaves nothing behind.
#![allow(dead_code, unused_imports)] // each check file uses a different subset of these helpers

mod check;
mod emulator;
mod engine;
mod health;
mod http;
mod net;
mod secrets;
mod wait;

pub use check::{Ctx, Env, TempDir, check};
pub use emulator::{EmulatorFiles, OwnEmulator, direct_health, emulator_dir, sha256_file};
pub use engine::{Engine, EngineCmd, Output};
pub use health::{
    assert_answered_in_time, assert_reachable, assert_unreachable, get_health, is_reachable,
};
pub use http::{Request, Response};
pub use net::{
    CountingListener, connect, ensure_port_free, free_port, free_port_without_emulator,
    non_loopback_ipv4,
};
pub use wait::wait_for;
