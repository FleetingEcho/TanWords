use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, Wry};

/// Menu item handles the frontend updates live (via [`tray_update_now_playing`])
/// as playback state changes, plus a flag distinguishing "hide to tray" from a
/// real quit so the window close button can be repurposed without breaking
/// Cmd+Q / the tray Quit item.
pub struct TrayState {
    items: Mutex<TrayItems>,
    pub quitting: AtomicBool,
}

struct TrayItems {
    toggle: MenuItem<Wry>,
    prev: MenuItem<Wry>,
    next: MenuItem<Wry>,
}

// Every row is prefixed with a glyph. These are text, not images, so they
// inherit the menu's foreground colour and stay legible in both light and dark
// menu bars — macOS does not invert menu-item images, so an embedded PNG icon
// would disappear in one theme or the other.
const GLYPH_PLAY: &str = "▶";
const GLYPH_PAUSE: &str = "⏸";
const LABEL_PLAY: &str = "▶  Play";

pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle_play", LABEL_PLAY, false, None::<&str>)?;
    let prev = MenuItem::with_id(app, "prev_track", "⏮  Previous", false, None::<&str>)?;
    let next = MenuItem::with_id(app, "next_track", "⏭  Next", false, None::<&str>)?;
    let refresh_rss = MenuItem::with_id(app, "refresh_rss", "⟳  Refresh RSS", true, None::<&str>)?;
    let show_window = MenuItem::with_id(app, "show_window", "⌂  Show TanWords", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "✕  Quit TanWords", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &toggle,
            &prev,
            &next,
            &PredefinedMenuItem::separator(app)?,
            &refresh_rss,
            &PredefinedMenuItem::separator(app)?,
            &show_window,
            &quit,
        ],
    )?;

    app.manage(TrayState {
        items: Mutex::new(TrayItems { toggle, prev, next }),
        quitting: AtomicBool::new(false),
    });

    TrayIconBuilder::with_id("main-tray")
        .icon(tray_icon(app))
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .build(app)?;

    Ok(())
}

/// macOS draws template icons from the alpha channel alone, so the opaque
/// square app icon renders as a solid white block up there. Use a dedicated
/// transparent-background "T" mark instead (icons/tray-template.png).
/// Windows and Linux tray icons aren't templated and keep the app icon.
fn tray_icon(app: &AppHandle) -> tauri::image::Image<'_> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))
            .expect("tray template icon")
    }
    #[cfg(not(target_os = "macos"))]
    {
        app.default_window_icon().cloned().expect("app icon")
    }
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "toggle_play" => {
            let _ = app.emit("tray-toggle-play", ());
        }
        "prev_track" => {
            let _ = app.emit("tray-prev", ());
        }
        "next_track" => {
            let _ = app.emit("tray-next", ());
        }
        "refresh_rss" => {
            let _ = app.emit("tray-refresh-rss", ());
        }
        "show_window" => show_main_window(app),
        "quit" => {
            if let Some(state) = app.try_state::<TrayState>() {
                state.quitting.store(true, Ordering::SeqCst);
            }
            app.exit(0);
        }
        _ => {}
    }
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Called by the frontend whenever `podcastPlayerStore`'s status/track/playlist
/// changes, so the tray menu mirrors what's actually playing without the user
/// having to open the main window.
#[tauri::command]
pub fn tray_update_now_playing(
    state: State<'_, TrayState>,
    title: Option<String>,
    playing: bool,
    has_playlist: bool,
) -> Result<(), String> {
    let items = state.items.lock().map_err(|e| e.to_string())?;

    let label = match &title {
        Some(t) => {
            let short: String = t.chars().take(40).collect();
            // The track title takes the place of the "Play"/"Pause" word —
            // the glyph already says which action the row performs.
            format!("{}  {short}", if playing { GLYPH_PAUSE } else { GLYPH_PLAY })
        }
        None => LABEL_PLAY.to_string(),
    };
    items.toggle.set_text(label).map_err(|e| e.to_string())?;
    items.toggle.set_enabled(title.is_some()).map_err(|e| e.to_string())?;
    items.prev.set_enabled(has_playlist).map_err(|e| e.to_string())?;
    items.next.set_enabled(has_playlist).map_err(|e| e.to_string())?;

    Ok(())
}
