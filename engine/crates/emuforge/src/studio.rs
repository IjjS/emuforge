//! The Studio build this binary embeds, if any. Only `embedded` depends on the feature `embed-studio`; everything
//! that serves the files is `emuforge-server`'s, built and tested without it.

use emuforge_server::{Error, StudioFiles};

// `STUDIO_FILES`, written by build.rs from `studio/dist`.
#[cfg(feature = "embed-studio")]
include!(concat!(env!("OUT_DIR"), "/studio_files.rs"));

/// The files `build.rs` embedded from `studio/dist`.
#[cfg(feature = "embed-studio")]
pub fn embedded() -> Result<Option<StudioFiles>, Error> {
    StudioFiles::new(STUDIO_FILES.iter().copied()).map(Some)
}

/// `None`: this build embeds no Studio.
#[cfg(not(feature = "embed-studio"))]
pub fn embedded() -> Result<Option<StudioFiles>, Error> {
    Ok(None)
}

#[cfg(test)]
mod tests {
    #[cfg(not(feature = "embed-studio"))]
    #[test]
    fn embedded_without_embed_studio_is_none() {
        assert!(super::embedded().unwrap().is_none());
    }
}
