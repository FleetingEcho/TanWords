//! A single native child webview embedded in the main window, backing the
//! Browser page: paste any URL and it renders in-app. This is deliberately
//! a *child webview* (`Window::add_child`, a real WKWebView layered over the
//! window) rather than an `<iframe>` — most real sites (X included) send
//! `X-Frame-Options`/`frame-ancestors` headers that block iframe embedding
//! outright. A child webview is a separate top-level navigation, not a
//! framed document, so it isn't subject to that at all.
//!
//! Cookies/localStorage persist to disk by default (no `incognito` set on
//! the builder), so a login survives relaunches without any extra code —
//! the only explicit action is `browser_clear_data`.
//!
//! Only one panel exists at a time (no multi-tab). It is created lazily on
//! first `browser_show` and then just repositioned/shown/hidden after that,
//! so switching away from and back to the Browser page doesn't tear down
//! the session or discard scroll position. The Browser *page* itself
//! unmounts/remounts across navigation though, losing its React state — so
//! the last known url/title live here too, readable via `browser_get_state`,
//! letting a remounted page resync with whatever the (still-alive) panel is
//! actually showing instead of reverting to an empty address bar.

use std::sync::Mutex;
use serde::Serialize;
use tauri::webview::PageLoadEvent;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Rect, Size, State, Webview,
    WebviewBuilder, WebviewUrl,
};
use url::Url;

const PANEL_LABEL: &str = "browser-panel";

#[derive(Default)]
struct PanelInfo {
    webview: Option<Webview>,
    url: String,
    title: String,
}

#[derive(Default)]
pub struct BrowserPanelState {
    inner: Mutex<PanelInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserState {
    pub url: String,
    pub title: String,
    pub opened: bool,
}

fn parse_navigable_url(raw: &str) -> Result<Url, String> {
    let parsed = Url::parse(raw).map_err(|_| "That doesn't look like a valid URL".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http:// and https:// links can be opened".into());
    }
    Ok(parsed)
}

fn with_webview<T>(
    state: &State<'_, BrowserPanelState>,
    f: impl FnOnce(&Webview) -> tauri::Result<T>,
) -> Result<T, String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    let webview = guard.webview.as_ref().ok_or("Browser panel is not open")?;
    f(webview).map_err(|e| e.to_string())
}

/// Whatever the panel is currently showing, so a freshly (re)mounted Browser
/// page can sync its address bar instead of assuming nothing is open.
#[tauri::command]
pub fn browser_get_state(state: State<'_, BrowserPanelState>) -> Result<BrowserState, String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    Ok(BrowserState {
        url: guard.url.clone(),
        title: guard.title.clone(),
        opened: guard.webview.is_some(),
    })
}

/// Opens the panel at the given (logical-pixel) bounds, creating it on first
/// call and just repositioning/showing it afterward. `url` is only used on
/// creation and on an explicit navigation — a bare reposition (e.g. from a
/// window resize) passes `None` and leaves whatever page is loaded alone.
#[tauri::command]
pub fn browser_show(
    app: AppHandle,
    state: State<'_, BrowserPanelState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    url: Option<String>,
) -> Result<(), String> {
    #[cfg(debug_assertions)]
    eprintln!("[browser_panel] show x={x} y={y} w={width} h={height} url={url:?}");
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    if let Some(webview) = guard.webview.clone() {
        // One atomic `set_bounds` call, not separate `set_position` + `set_size`.
        // On macOS each of those does a read-current-bounds/patch-one-field/write-back
        // internally, and the position math flips y using the view's *current* height
        // (AppKit views are bottom-left-origin unless flipped) — so calling them back
        // to back applies the new position against the stale old height for one frame,
        // visibly placing the panel a row too high whenever height actually changes.
        webview
            .set_bounds(Rect {
                position: Position::Logical(LogicalPosition::new(x, y)),
                size: Size::Logical(LogicalSize::new(width, height)),
            })
            .map_err(|e| e.to_string())?;
        webview.show().map_err(|e| e.to_string())?;
        if let Some(url) = url {
            let target = parse_navigable_url(&url)?;
            webview.navigate(target).map_err(|e| e.to_string())?;
            guard.url = url;
        }
        #[cfg(debug_assertions)]
        if let (Ok(pos), Ok(size), Some(window)) =
            (webview.position(), webview.size(), app.get_window("main"))
        {
            eprintln!(
                "[browser_panel] readback (physical) pos={pos:?} size={size:?} window_inner={:?} scale={:?}",
                window.inner_size(),
                window.scale_factor()
            );
        }
        return Ok(());
    }

    let target = match &url {
        Some(url) => parse_navigable_url(url)?,
        None => Url::parse("about:blank").expect("static URL"),
    };
    let window = app.get_window("main").ok_or("Main window not found")?;

    let nav_handle = app.clone();
    let title_handle = app.clone();
    let load_handle = app.clone();
    let builder = WebviewBuilder::new(PANEL_LABEL, WebviewUrl::External(target))
        .on_navigation(move |url| {
            let url = url.to_string();
            if let Some(state) = nav_handle.try_state::<BrowserPanelState>() {
                if let Ok(mut guard) = state.inner.lock() {
                    guard.url = url.clone();
                }
            }
            let _ = nav_handle.emit("browser://navigated", url);
            true
        })
        .on_document_title_changed(move |_webview, title| {
            if let Some(state) = title_handle.try_state::<BrowserPanelState>() {
                if let Ok(mut guard) = state.inner.lock() {
                    guard.title = title.clone();
                }
            }
            let _ = title_handle.emit("browser://title-changed", title);
        })
        .on_page_load(move |_webview, payload| {
            let loading = payload.event() == PageLoadEvent::Started;
            let _ = load_handle.emit("browser://loading", loading);
        });

    let webview = window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    #[cfg(debug_assertions)]
    if let (Ok(pos), Ok(size)) = (webview.position(), webview.size()) {
        eprintln!(
            "[browser_panel] created (physical) pos={pos:?} size={size:?} window_inner={:?} scale={:?}",
            window.inner_size(),
            window.scale_factor()
        );
    }
    guard.webview = Some(webview);
    guard.url = url.unwrap_or_default();
    Ok(())
}

/// Navigates the existing panel. Errors if it hasn't been opened yet —
/// callers always go through `browser_show` first, which creates it.
#[tauri::command]
pub fn browser_navigate(state: State<'_, BrowserPanelState>, url: String) -> Result<(), String> {
    let target = parse_navigable_url(&url)?;
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    let webview = guard.webview.as_ref().ok_or("Browser panel is not open")?;
    webview.navigate(target).map_err(|e| e.to_string())?;
    guard.url = url;
    Ok(())
}

#[tauri::command]
pub fn browser_reload(state: State<'_, BrowserPanelState>) -> Result<(), String> {
    with_webview(&state, |webview| webview.reload())
}

/// No native back/forward API exists on `Webview`; `history.back()` inside
/// the page itself is the documented way to drive it externally.
#[tauri::command]
pub fn browser_go_back(state: State<'_, BrowserPanelState>) -> Result<(), String> {
    with_webview(&state, |webview| webview.eval("history.back()"))
}

#[tauri::command]
pub fn browser_go_forward(state: State<'_, BrowserPanelState>) -> Result<(), String> {
    with_webview(&state, |webview| webview.eval("history.forward()"))
}

/// Repositions the panel to track the placeholder `<div>` it sits under —
/// called on every window resize / layout change while the Browser page is
/// visible. A no-op (not an error) before the panel has been created, since
/// the frontend's ResizeObserver can fire before the first `browser_show`.
#[tauri::command]
pub fn browser_set_bounds(
    state: State<'_, BrowserPanelState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    #[cfg(debug_assertions)]
    eprintln!("[browser_panel] set_bounds x={x} y={y} w={width} h={height}");
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    let Some(webview) = guard.webview.as_ref() else { return Ok(()) };
    webview
        .set_bounds(Rect {
            position: Position::Logical(LogicalPosition::new(x, y)),
            size: Size::Logical(LogicalSize::new(width, height)),
        })
        .map_err(|e| e.to_string())
}

/// Hides the panel without destroying it, so the session (login, scroll
/// position, in-page navigation) survives leaving and returning to the
/// Browser page. Child webviews render as a native layer above the rest of
/// the window's HTML, so leaving this visible while another page shows
/// would visibly cover it — every other page must call this on unmount.
#[tauri::command]
pub fn browser_hide(state: State<'_, BrowserPanelState>) -> Result<(), String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    match guard.webview.as_ref() {
        Some(webview) => webview.hide().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// Wipes cookies/localStorage/cache for the panel's webview. Distinct from
/// closing it — the panel itself stays alive, just logged out.
#[tauri::command]
pub fn browser_clear_data(state: State<'_, BrowserPanelState>) -> Result<(), String> {
    with_webview(&state, |webview| webview.clear_all_browsing_data())
}
