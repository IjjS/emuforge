//! With the feature `embed-studio`, embeds Studio's production build (`studio/dist` of the checkout, from
//! `bun run build`) by writing `$OUT_DIR/studio_files.rs`; without it, does nothing.

#![forbid(unsafe_code)]

#[path = "src/embed.rs"]
mod embed;

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() -> Result<(), String> {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src/embed.rs");
    if env::var_os("CARGO_FEATURE_EMBED_STUDIO").is_none() {
        return Ok(());
    }
    let manifest = env::var_os("CARGO_MANIFEST_DIR").ok_or("CARGO_MANIFEST_DIR is not set")?;
    let out = env::var_os("OUT_DIR").ok_or("OUT_DIR is not set")?;
    // engine/crates/emuforge → the checkout's studio/dist.
    let dist = PathBuf::from(manifest).join("../../../studio/dist");
    println!("cargo:rerun-if-changed={}", dist.display());
    for (_, path) in embed::files(&dist)? {
        println!("cargo:rerun-if-changed={}", path.display());
    }
    let text = embed::source(&dist)?;
    let target = PathBuf::from(out).join("studio_files.rs");
    fs::write(&target, text).map_err(|error| format!("cannot write {}: {error}", target.display()))
}
