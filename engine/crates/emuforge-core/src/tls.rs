//! The TLS client configuration for the emulator: its `ca.pem` is the only trust root.

use std::sync::Arc;

use rustls::{ClientConfig, RootCertStore};

use crate::{EmulatorFiles, Error};

/// A client configuration whose root store holds the certificates of `ca.pem` and nothing else.
pub fn client_config(files: &EmulatorFiles) -> Result<Arc<ClientConfig>, Error> {
    let mut roots = RootCertStore::empty();
    for certificate in files.ca() {
        roots
            .add(certificate.clone())
            .map_err(|_| Error::TrustStore)?;
    }
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let mut config = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|_| Error::TlsConfig)?
        .with_root_certificates(roots)
        .with_no_client_auth();
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(Arc::new(config))
}
