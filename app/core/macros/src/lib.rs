//! The `#[command]` attribute is a marker, nothing more.
//!
//! Tauri's version generated an IPC wrapper. Ours does not need to: the
//! wrappers live in `src/rpc/dispatch.rs`, generated ahead of time by
//! `scripts/gen_dispatch.py`, which finds commands by scanning for this
//! attribute. So the attribute must stay on the functions, and must expand to
//! the function unchanged.
//!
//! `#[command(async)]` is accepted and also ignored here — the generator reads
//! that flag itself and emits a `spawn_blocking` call for those.
use proc_macro::TokenStream;

#[proc_macro_attribute]
pub fn command(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}
