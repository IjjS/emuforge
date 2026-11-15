//! Helpers shared by the engine integration checks. Each file under `tests/` includes this module with
//! `#[path = "../support/mod.rs"] mod support;`.
//!
//! The check contract is in `check.rs`. Everything a check starts (engines, emulators, listeners, temporary
//! directories) is owned by a guard that cleans up on drop, so a failed assertion leaves nothing behind.
#![allow(dead_code, unused_imports)] // each check file uses a different subset of these helpers

mod aws;
mod body;
mod check;
mod chunked;
mod close;
mod emulator;
mod engine;
mod fifo;
mod fixtures;
mod health;
mod http;
mod lsof;
mod net;
mod pair;
mod recorder;
pub mod secrets;
pub mod studio;
mod wait;

pub use aws::{Auth, CHECK_ACCESS_KEY_ID, Call, Endpoint, Key, Payload, percent_encode};
pub use body::{aws_chunked_unsigned_trailer, base64, crc32_header, crc64nvme_header, seeded};
pub use check::{Ctx, Env, TempDir, check};
pub use chunked::{
    ECDSA_CHUNKS, Malformed, SIGNED_CHUNKS, SIGNED_CHUNKS_TRAILER, SignedChunkUpload,
    ZERO_SIGNATURE, md5_hex, signed_chunk_pair, signed_chunk_put,
};
pub use close::{End, Exchange, close_exchange, direct_head};
pub use emulator::{EmulatorFiles, OwnEmulator, direct_health, emulator_dir, sha256_file};
pub use engine::{Engine, EngineCmd, Output};
pub use fifo::{ENXIO, HeldFifo, open_write_nonblocking};
pub use fixtures::{Bucket, Direct, Queue, Table, User, prefix};
pub use health::{
    assert_answered_in_time, assert_reachable, assert_unreachable, get_health, is_reachable,
};
pub use http::{Request, Response};
pub use lsof::{listening_pids, tcp_remotes};
pub use net::{
    CountingListener, connect, ensure_port_free, free_port, free_port_without_emulator,
    non_loopback_ipv4,
};
pub use pair::{Pair, assert_matches_direct, elements, matches_direct, normalize, pair, pair_with};
pub use recorder::{HeldResponse, RequestRecorder, header_value, query_value, request_target};
pub use wait::wait_for;
