//! The native child webviews backing the Browser page: paste any URL and it
//! renders in-app. These are deliberately *child webviews*
//! (`Window::add_child`, real WKWebViews layered over the window) rather than
//! `<iframe>`s — most real sites (X included) send
//! `X-Frame-Options`/`frame-ancestors` headers that block iframe embedding
//! outright. A child webview is a separate top-level navigation, not a
//! framed document, so it isn't subject to that at all.
//!
//! Cookies/localStorage persist to disk by default (no `incognito` set on
//! the builder), so a login survives relaunches without any extra code —
//! the explicit escape hatches are `browser_clear_data` and
//! `browser_hard_reload`.
//!
//! One webview per tab, all siblings in the main window, with exactly one
//! visible at a time — `browser_show` shows its target and hides every
//! other. Tabs are created lazily and then just repositioned/shown/hidden,
//! so switching tabs (or leaving the Browser page and coming back) never
//! tears down a session or discards scroll position.
//!
//! Tab identity lives here rather than in the frontend, because the Browser
//! *page* unmounts/remounts across navigation and loses its React state
//! while the webviews stay alive. `browser_get_state` lets a remounted page
//! resync with the tabs that actually exist — a frontend-side id counter
//! would restart from scratch and collide with them.

use std::sync::Mutex;
use serde::Serialize;
use tauri::webview::PageLoadEvent;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Rect, Size, State, Webview,
    WebviewBuilder, WebviewUrl,
};
use url::Url;

struct Tab {
    id: String,
    webview: Webview,
    url: String,
    title: String,
    /// Parked on the Browser page's home screen: the webview is hidden but
    /// still alive. Tracked here, not just in React, because the page
    /// remounts across navigation and would otherwise resurrect the site a
    /// tab was explicitly sent home from.
    at_home: bool,
}

#[derive(Default)]
struct PanelInfo {
    /// Creation order, which is also the order the tab strip renders in.
    tabs: Vec<Tab>,
    active: Option<String>,
    /// Monotonic, never reused — a closed tab's label must not come back.
    next_id: u64,
}

impl PanelInfo {
    fn find_mut(&mut self, id: &str) -> Option<&mut Tab> {
        self.tabs.iter_mut().find(|t| t.id == id)
    }

    /// Every tab except `keep` goes invisible. Child webviews render as a
    /// native layer above the window's HTML, so two visible at once would
    /// just stack on top of each other.
    fn hide_others(&self, keep: &str) {
        for tab in &self.tabs {
            if tab.id != keep {
                let _ = tab.webview.hide();
            }
        }
    }
}

#[derive(Default)]
pub struct BrowserPanelState {
    inner: Mutex<PanelInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabState {
    pub id: String,
    pub url: String,
    pub title: String,
    pub at_home: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserState {
    pub tabs: Vec<TabState>,
    pub active: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TabEvent<T> {
    tab_id: String,
    value: T,
}

fn parse_navigable_url(raw: &str) -> Result<Url, String> {
    let parsed = Url::parse(raw).map_err(|_| "That doesn't look like a valid URL".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http:// and https:// links can be opened".into());
    }
    Ok(parsed)
}

fn logical_rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
    // One atomic `set_bounds`, never separate `set_position` + `set_size`. On
    // macOS each of those does a read-current-bounds/patch-one-field/write-back
    // internally, and the position math flips y using the view's *current*
    // height (AppKit views are bottom-left-origin unless flipped) — so calling
    // them back to back applies the new position against the stale old height
    // for one frame, visibly placing the panel a row too high whenever the
    // height actually changes.
    Rect {
        position: Position::Logical(LogicalPosition::new(x, y)),
        size: Size::Logical(LogicalSize::new(width, height)),
    }
}

fn with_tab<T>(
    state: &State<'_, BrowserPanelState>,
    tab_id: &str,
    f: impl FnOnce(&Webview) -> tauri::Result<T>,
) -> Result<T, String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    let tab = guard
        .tabs
        .iter()
        .find(|t| t.id == tab_id)
        .ok_or("That browser tab is no longer open")?;
    f(&tab.webview).map_err(|e| e.to_string())
}

/// Every tab that currently exists, in strip order, plus which one is
/// frontmost — so a freshly (re)mounted Browser page can rebuild its whole
/// tab bar instead of assuming nothing is open.
#[tauri::command]
pub fn browser_get_state(state: State<'_, BrowserPanelState>) -> Result<BrowserState, String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    Ok(BrowserState {
        tabs: guard
            .tabs
            .iter()
            .map(|t| TabState {
                id: t.id.clone(),
                url: t.url.clone(),
                title: t.title.clone(),
                at_home: t.at_home,
            })
            .collect(),
        active: guard.active.clone(),
    })
}

/// Shows one tab at the given (logical-pixel) bounds and hides the rest,
/// returning the tab's id.
///
/// Passing `tab_id: None` creates a new tab; passing an existing id
/// repositions/reveals that one. `url` is only applied on creation and on an
/// explicit navigation — a bare reposition (e.g. from a window resize or a
/// tab switch) passes `None` and leaves whatever page is loaded alone.
#[tauri::command]
pub fn browser_show(
    app: AppHandle,
    state: State<'_, BrowserPanelState>,
    tab_id: Option<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    url: Option<String>,
) -> Result<String, String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;

    if let Some(id) = tab_id {
        // Validate the URL before touching any webview, so a typo can't leave
        // the panel half-repositioned.
        let target = match &url {
            Some(raw) => Some(parse_navigable_url(raw)?),
            None => None,
        };
        if !guard.tabs.iter().any(|t| t.id == id) {
            return Err("That browser tab is no longer open".into());
        }
        guard.hide_others(&id);

        let tab = guard.find_mut(&id).expect("presence checked above");
        tab.webview
            .set_bounds(logical_rect(x, y, width, height))
            .map_err(|e| e.to_string())?;
        tab.webview.show().map_err(|e| e.to_string())?;
        tab.at_home = false;
        if let Some(target) = target {
            tab.webview.navigate(target).map_err(|e| e.to_string())?;
            tab.url = url.unwrap_or_default();
        }
        guard.active = Some(id.clone());
        return Ok(id);
    }

    let target = match &url {
        Some(url) => parse_navigable_url(url)?,
        None => Url::parse("about:blank").expect("static URL"),
    };
    let window = app.get_window("main").ok_or("Main window not found")?;

    guard.next_id += 1;
    let id = format!("t{}", guard.next_id);
    let label = format!("browser-panel-{id}");

    let builder = WebviewBuilder::new(&label, WebviewUrl::External(target))
        .on_navigation({
            let app = app.clone();
            let id = id.clone();
            move |url| {
                // Fires for *every* frame, not just the main one — see
                // `accept_soft_navigation` for why the URL is filtered.
                let url = url.to_string();
                if accept_soft_navigation(&app, &id, &url) {
                    let _ = app.emit("browser://navigated", TabEvent { tab_id: id.clone(), value: url });
                }
                true
            }
        })
        .on_document_title_changed({
            let app = app.clone();
            let id = id.clone();
            move |_webview, title| {
                cache_title(&app, &id, &title);
                let _ = app.emit("browser://title-changed", TabEvent { tab_id: id.clone(), value: title });
            }
        })
        .on_page_load({
            let app = app.clone();
            let id = id.clone();
            move |_webview, payload| {
                let loading = payload.event() == PageLoadEvent::Started;
                let _ = app.emit("browser://loading", TabEvent { tab_id: id.clone(), value: loading });
                // The authoritative address. Unlike `on_navigation` this is
                // driven by the main frame's own load events, so it can't be
                // hijacked by a subframe.
                if loading {
                    let url = payload.url().to_string();
                    cache_url(&app, &id, &url);
                    let _ = app.emit("browser://navigated", TabEvent { tab_id: id.clone(), value: url });
                }
            }
        });

    guard.hide_others(&id);
    let webview = window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;

    guard.tabs.push(Tab {
        id: id.clone(),
        webview,
        url: url.unwrap_or_default(),
        title: String::new(),
        at_home: false,
    });
    guard.active = Some(id.clone());
    Ok(id)
}

/// Both cache helpers use `try_lock` rather than `lock`: they run on the main
/// thread from webview callbacks that can fire *during* `add_child`, while
/// `browser_show` still holds the mutex. Blocking there would deadlock the UI
/// thread. Losing one cache update is harmless — the event still reaches the
/// frontend, which is the real source of truth for what's on screen; this
/// copy only exists to repopulate a remounted page.
/// Decides whether an `on_navigation` URL is allowed to become the tab's
/// displayed address.
///
/// wry wires `on_navigation` to WebKit's `decidePolicyForNavigationAction`,
/// which fires for **every frame** — and it discards
/// `action.targetFrame.isMainFrame` before handing us the URL, so there is no
/// way to tell a top-level navigation from an iframe's. Taking it at face
/// value meant any embedded widget clobbered the address bar: visiting a page
/// with a Google Sign-In button parked
/// `accounts.google.com/gsi/button?...` there.
///
/// Main-frame navigations already arrive via `on_page_load`, which is driven
/// by the main frame's own load events and cannot be spoofed by a subframe.
/// This callback therefore only needs to cover what `on_page_load` misses:
/// same-document navigation (`pushState`/`replaceState`/hash changes), which
/// SPAs use constantly and which fires no load event at all. Those are always
/// same-origin with the page already loaded, so that's the filter — an
/// off-origin embed can no longer speak for the tab.
///
/// Residual gap: a same-origin subframe can still nudge the address bar. That
/// beats the alternative of an address bar that goes stale the moment you
/// click anything inside an SPA.
fn accept_soft_navigation(app: &AppHandle, tab_id: &str, url: &str) -> bool {
    let Some(state) = app.try_state::<BrowserPanelState>() else {
        return false;
    };
    let Ok(mut guard) = state.inner.try_lock() else {
        return false;
    };
    let Some(tab) = guard.find_mut(tab_id) else {
        return false;
    };
    if tab.url == url || !same_origin(&tab.url, url) {
        return false;
    }
    tab.url = url.to_string();
    true
}

/// Opaque origins (`about:blank`, unparseable) never compare equal, which is
/// the conservative answer here.
fn same_origin(a: &str, b: &str) -> bool {
    match (Url::parse(a), Url::parse(b)) {
        (Ok(a), Ok(b)) => a.origin() == b.origin(),
        _ => false,
    }
}

fn cache_url(app: &AppHandle, tab_id: &str, url: &str) {
    if let Some(state) = app.try_state::<BrowserPanelState>() {
        if let Ok(mut guard) = state.inner.try_lock() {
            if let Some(tab) = guard.find_mut(tab_id) {
                tab.url = url.to_string();
            }
        }
    }
}

fn cache_title(app: &AppHandle, tab_id: &str, title: &str) {
    if let Some(state) = app.try_state::<BrowserPanelState>() {
        if let Ok(mut guard) = state.inner.try_lock() {
            if let Some(tab) = guard.find_mut(tab_id) {
                tab.title = title.to_string();
            }
        }
    }
}

/// Navigates an existing tab. Errors if it isn't open — callers always go
/// through `browser_show` first, which creates it.
#[tauri::command]
pub fn browser_navigate(
    state: State<'_, BrowserPanelState>,
    tab_id: String,
    url: String,
) -> Result<(), String> {
    let target = parse_navigable_url(&url)?;
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    let tab = guard
        .find_mut(&tab_id)
        .ok_or("That browser tab is no longer open")?;
    tab.webview.navigate(target).map_err(|e| e.to_string())?;
    tab.url = url;
    Ok(())
}

#[tauri::command]
pub fn browser_reload(state: State<'_, BrowserPanelState>, tab_id: String) -> Result<(), String> {
    with_tab(&state, &tab_id, |webview| webview.reload())
}

/// Reload with the site's local state thrown away first — cookies,
/// localStorage, sessionStorage, IndexedDB and the HTTP cache. Note that
/// every tab shares one data store, so this logs you out everywhere, not
/// just in this tab; the button is labelled accordingly.
#[tauri::command]
pub fn browser_hard_reload(
    state: State<'_, BrowserPanelState>,
    tab_id: String,
) -> Result<(), String> {
    with_tab(&state, &tab_id, |webview| {
        webview.clear_all_browsing_data()?;
        webview.reload()
    })
}

/// No native back/forward API exists on `Webview`; `history.back()` inside
/// the page itself is the documented way to drive it externally.
#[tauri::command]
pub fn browser_go_back(state: State<'_, BrowserPanelState>, tab_id: String) -> Result<(), String> {
    with_tab(&state, &tab_id, |webview| webview.eval("history.back()"))
}

#[tauri::command]
pub fn browser_go_forward(
    state: State<'_, BrowserPanelState>,
    tab_id: String,
) -> Result<(), String> {
    with_tab(&state, &tab_id, |webview| webview.eval("history.forward()"))
}

/// Parks a tab on the home screen: hides its webview and forgets the address,
/// without ending the session. Distinct from `browser_close_tab` (which
/// destroys the webview) and from `browser_hide` (which is transient — it says
/// nothing about *why* a tab is invisible, so it can't survive a remount).
#[tauri::command]
pub fn browser_go_home(state: State<'_, BrowserPanelState>, tab_id: String) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    let tab = guard
        .find_mut(&tab_id)
        .ok_or("That browser tab is no longer open")?;
    let _ = tab.webview.hide();
    tab.at_home = true;
    tab.url = String::new();
    tab.title = String::new();
    Ok(())
}

/// Destroys a tab's webview for good. Unlike `browser_hide` this does end the
/// session for that tab (scroll position, in-page state); the shared cookie
/// jar is untouched, so reopening the site stays logged in.
#[tauri::command]
pub fn browser_close_tab(
    state: State<'_, BrowserPanelState>,
    tab_id: String,
) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    let Some(index) = guard.tabs.iter().position(|t| t.id == tab_id) else {
        return Ok(());
    };
    let tab = guard.tabs.remove(index);
    let _ = tab.webview.close();
    if guard.active.as_deref() == Some(tab_id.as_str()) {
        guard.active = None;
    }
    Ok(())
}

/// Repositions the panel to track the placeholder `<div>` it sits under —
/// called on every window resize / layout change while the Browser page is
/// visible. Applies to *every* tab, not just the visible one, so switching
/// to a background tab never flashes it at a stale size. A no-op (not an
/// error) before any tab exists, since the frontend's ResizeObserver can
/// fire before the first `browser_show`.
#[tauri::command]
pub fn browser_set_bounds(
    state: State<'_, BrowserPanelState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    let bounds = logical_rect(x, y, width, height);
    for tab in &guard.tabs {
        tab.webview.set_bounds(bounds).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Hides tabs without destroying them, so their sessions (login, scroll
/// position, in-page navigation) survive. `tab_id: None` hides all of them —
/// child webviews render as a native layer above the rest of the window's
/// HTML, so leaving any visible while another page shows would visibly cover
/// it. The Browser page calls this on unmount, and again whenever the active
/// tab switches to its home screen.
#[tauri::command]
pub fn browser_hide(
    state: State<'_, BrowserPanelState>,
    tab_id: Option<String>,
) -> Result<(), String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    for tab in &guard.tabs {
        let targeted = match tab_id.as_deref() {
            Some(id) => id == tab.id,
            None => true,
        };
        if targeted {
            let _ = tab.webview.hide();
        }
    }
    Ok(())
}

/// Wipes cookies/localStorage/cache for the whole panel (one shared data
/// store across tabs). Distinct from closing anything — the tabs stay alive,
/// just logged out. Unlike `browser_hard_reload` it does not reload.
#[tauri::command]
pub fn browser_clear_data(state: State<'_, BrowserPanelState>) -> Result<(), String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    match guard.tabs.first() {
        Some(tab) => tab
            .webview
            .clear_all_browsing_data()
            .map_err(|e| e.to_string()),
        None => Ok(()),
    }
}
