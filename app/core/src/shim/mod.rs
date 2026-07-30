//! Tauri-shaped API surface, backed by the sidecar instead of Tauri.
//!
//! The point of this module is that the other ~15k lines of this crate do not
//! change. Every command still writes `State<'_, AppState>`, `AppHandle`,
//! `app.emit(..)` and `app.try_state::<T>()` exactly as before; they just
//! resolve here now. Migrating a file is a find/replace, not a rewrite:
//!
//! ```text
//! rg -l 'tauri::' src/ | xargs sed -i \
//!   -e 's/#\[tauri::command\]/#[crate::shim::command]/' \
//!   -e 's/#\[tauri::command(async)\]/#[crate::shim::command(async)]/' \
//!   -e 's/\btauri::State\b/crate::shim::State/g' \
//!   -e 's/\btauri::AppHandle\b/crate::shim::AppHandle/g' \
//!   -e 's/use tauri::\{/use crate::shim::{/'
//! ```
//!
//! then `cargo check` and fix what is left. Do NOT delete the `#[..::command]`
//! attributes — `build.rs`'s `generate_dispatch_table()` finds the commands
//! by scanning for them, on every `cargo build`/`cargo check`.

use std::any::{Any, TypeId};
use std::collections::HashMap;
use std::ops::Deref;
use std::sync::Arc;

use serde::Serialize;
use tokio::sync::broadcast;

pub use tanwords_macros::command;

/// Stands in for `crate::shim::State`. A transparent borrow, so every existing
/// `state.field` / `state.method()` call site keeps working through `Deref`.
pub struct State<'a, T: 'static>(&'a T);

// Written by hand rather than `#[derive(Clone, Copy)]`: the derive macro
// would add a `T: Clone` / `T: Copy` bound, but `&T` is `Copy` regardless of
// whether `T` is — and `AppState` (holding `Mutex`es) never will be.
impl<'a, T: 'static> Clone for State<'a, T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<'a, T: 'static> Copy for State<'a, T> {}

impl<'a, T: 'static> Deref for State<'a, T> {
    type Target = T;
    fn deref(&self) -> &T {
        self.0
    }
}

impl<'a, T: 'static> State<'a, T> {
    /// The only way to build one outside this module — `rpc::Ctx::state` uses it.
    pub fn from_ref(value: &'a T) -> Self {
        State(value)
    }

    pub fn inner(&self) -> &T {
        self.0
    }
}

/// One event as it goes out to the renderer over SSE.
#[derive(Clone, Serialize)]
pub struct Event {
    pub name: String,
    pub payload: serde_json::Value,
}

/// The managed-state registry. Replaces `Builder::manage` + `App::state`.
#[derive(Default)]
pub struct Registry {
    entries: HashMap<TypeId, Box<dyn Any + Send + Sync>>,
}

impl Registry {
    pub fn manage<T: Any + Send + Sync>(&mut self, value: T) -> &mut Self {
        self.entries.insert(TypeId::of::<T>(), Box::new(value));
        self
    }

    pub fn get<T: Any + Send + Sync>(&self) -> Option<&T> {
        self.entries
            .get(&TypeId::of::<T>())
            .and_then(|v| v.downcast_ref::<T>())
    }
}

/// Stands in for `crate::shim::AppHandle`. Cheap to clone, `Send + 'static`, so the
/// existing `let handle = app.handle().clone(); spawn(async move { .. })`
/// patterns in mcp/controller.rs and tts/download.rs still work.
#[derive(Clone)]
pub struct AppHandle {
    registry: Arc<Registry>,
    events: broadcast::Sender<Event>,
}

impl AppHandle {
    pub fn new(registry: Arc<Registry>, events: broadcast::Sender<Event>) -> Self {
        Self { registry, events }
    }

    /// `crate::shim::Emitter::emit`. Failure here means "nobody is listening", which
    /// is not an error — every existing call site already does `let _ = ..`.
    pub fn emit<P: Serialize>(&self, name: &str, payload: P) -> Result<(), String> {
        let payload = serde_json::to_value(payload).map_err(|e| e.to_string())?;
        let _ = self.events.send(Event { name: name.to_string(), payload });
        Ok(())
    }

    pub fn try_state<T: Any + Send + Sync>(&self) -> Option<State<'_, T>> {
        self.registry.get::<T>().map(State)
    }

    pub fn state<T: Any + Send + Sync>(&self) -> State<'_, T> {
        self.try_state::<T>().expect("state not managed")
    }

    /// `app.handle()` returned `&AppHandle`; callers then `.clone()` it.
    pub fn handle(&self) -> &AppHandle {
        self
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.events.subscribe()
    }
}
