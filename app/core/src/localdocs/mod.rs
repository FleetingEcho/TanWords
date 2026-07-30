//! Local markdown vault: file operations for a user-mounted folder on the
//! Documents page. Every command takes the mounted root plus a path relative
//! to it, and refuses anything that would escape the root — the frontend only
//! ever holds relative paths handed out by `localdocs_list`.

mod crud;
mod import_export;
mod list_search;
mod markdown_io;
mod paths;
mod types;

#[cfg(test)]
mod tests;

pub(crate) const MAX_DEPTH: usize = 12;

pub use crud::*;
pub use import_export::*;
pub use list_search::*;
pub use markdown_io::*;
pub use types::*;
