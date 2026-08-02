#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// The desktop sidecar entry point: opens the database and serves the
/// loopback IPC surface Electron talks to.
#[cfg(feature = "desktop")]
#[tokio::main]
async fn main() {
    tanwords_lib::run().await
}

/// This binary only means something for the desktop app. When the crate is
/// compiled without desktop features (the web/server build), it must still
/// *compile* — cargo builds every target — so it degrades to a clear message
/// rather than failing to link a missing `tanwords_lib::run`.
#[cfg(not(feature = "desktop"))]
fn main() {
    eprintln!("tanwords-core is the desktop sidecar, but this binary was built without desktop features.");
    eprintln!("For the web backend, run the `tanwords-web-server` crate under web/server instead.");
    std::process::exit(2);
}
