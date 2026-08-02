use rust_embed::RustEmbed;

/// The built renderer, compiled into the binary so deployment can ship a
/// single executable without a separate `app/out/renderer` directory.
#[derive(RustEmbed)]
#[folder = "../../app/out/renderer"]
pub struct Assets;
