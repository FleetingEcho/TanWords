use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{TrayIcon, TrayIconBuilder};
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
    /// Current playback title/state and playlist-availability, re-applied
    /// whenever the menu is rebuilt (e.g. on a language switch) so it doesn't
    /// revert to the idle "Play"/disabled state.
    now_playing: Option<(String, bool)>,
    has_playlist: bool,
    lang: Lang,
    tray_icon: TrayIcon<Wry>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Lang {
    En,
    Zh,
}

impl Lang {
    fn from_code(code: &str) -> Self {
        if code.eq_ignore_ascii_case("zh") { Lang::Zh } else { Lang::En }
    }
}

// Every row is prefixed with a glyph. These are text, not images, so they
// inherit the menu's foreground colour and stay legible in both light and dark
// menu bars — macOS does not invert menu-item images, so an embedded PNG icon
// would disappear in one theme or the other.
const GLYPH_PLAY: &str = "▶";
const GLYPH_PAUSE: &str = "⏸";

fn t_show_window(lang: Lang) -> &'static str {
    match lang { Lang::En => "Open main window", Lang::Zh => "打开主窗口" }
}
fn t_music_control(lang: Lang) -> &'static str {
    match lang { Lang::En => "Music Control", Lang::Zh => "音乐控制" }
}
fn t_play(lang: Lang) -> &'static str {
    match lang { Lang::En => "Play", Lang::Zh => "播放" }
}
fn t_prev(lang: Lang) -> &'static str {
    match lang { Lang::En => "Previous", Lang::Zh => "上一首" }
}
fn t_next(lang: Lang) -> &'static str {
    match lang { Lang::En => "Next", Lang::Zh => "下一首" }
}
fn t_refresh_rss(lang: Lang) -> &'static str {
    match lang { Lang::En => "Refresh RSS", Lang::Zh => "刷新 RSS" }
}
fn t_quit(lang: Lang) -> &'static str {
    match lang { Lang::En => "Quit", Lang::Zh => "退出" }
}

fn toggle_label(lang: Lang, now_playing: &Option<(String, bool)>) -> String {
    match now_playing {
        Some((title, playing)) => {
            let short: String = title.chars().take(40).collect();
            // The track title takes the place of the "Play"/"Pause" word —
            // the glyph already says which action the row performs.
            format!("{}  {short}", if *playing { GLYPH_PAUSE } else { GLYPH_PLAY })
        }
        None => format!("{GLYPH_PLAY}  {}", t_play(lang)),
    }
}

/// Builds a fresh menu (and its Play/Prev/Next handles) for the given
/// language/playback state. Called on startup and again on every language
/// switch — rebuilding from scratch rather than mutating an existing
/// `Submenu`'s text is what actually gets the submenu's own row label to
/// repaint reliably across platforms.
fn build_menu(
    app: &AppHandle,
    lang: Lang,
    now_playing: &Option<(String, bool)>,
    has_playlist: bool,
) -> tauri::Result<(Menu<Wry>, MenuItem<Wry>, MenuItem<Wry>, MenuItem<Wry>)> {
    let show_window = MenuItem::with_id(app, "show_window", t_show_window(lang), true, None::<&str>)?;
    let toggle = MenuItem::with_id(
        app,
        "toggle_play",
        toggle_label(lang, now_playing),
        now_playing.is_some(),
        None::<&str>,
    )?;
    let prev = MenuItem::with_id(app, "prev_track", format!("⏮  {}", t_prev(lang)), has_playlist, None::<&str>)?;
    let next = MenuItem::with_id(app, "next_track", format!("⏭  {}", t_next(lang)), has_playlist, None::<&str>)?;
    let music_control = Submenu::with_items(
        app,
        t_music_control(lang),
        true,
        &[&toggle, &prev, &next],
    )?;
    let refresh_rss = MenuItem::with_id(app, "refresh_rss", format!("⟳  {}", t_refresh_rss(lang)), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", t_quit(lang), true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &show_window,
            &music_control,
            &PredefinedMenuItem::separator(app)?,
            &refresh_rss,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    Ok((menu, toggle, prev, next))
}

pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let lang = Lang::En;
    let (menu, toggle, prev, next) = build_menu(app, lang, &None, false)?;

    let tray_icon_handle = TrayIconBuilder::with_id("main-tray")
        .icon(tray_icon(app))
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .build(app)?;

    app.manage(TrayState {
        items: Mutex::new(TrayItems {
            toggle,
            prev,
            next,
            now_playing: None,
            has_playlist: false,
            lang,
            tray_icon: tray_icon_handle,
        }),
        quitting: AtomicBool::new(false),
    });

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
        // A minimized window stays minimized through show()/set_focus() alone,
        // which is a likely state for both callers: the tray menu and a second
        // launch of the app.
        let _ = window.unminimize();
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
    let mut items = state.items.lock().map_err(|e| e.to_string())?;

    items.now_playing = title.clone().map(|t| (t, playing));
    items.has_playlist = has_playlist;
    let label = toggle_label(items.lang, &items.now_playing);
    items.toggle.set_text(label).map_err(|e| e.to_string())?;
    items.toggle.set_enabled(title.is_some()).map_err(|e| e.to_string())?;
    items.prev.set_enabled(has_playlist).map_err(|e| e.to_string())?;
    items.next.set_enabled(has_playlist).map_err(|e| e.to_string())?;

    Ok(())
}

/// Called on startup once the persisted `ui_language` setting resolves, and
/// again whenever the user changes it in Settings, so the tray mirrors the
/// in-app language ("en"/"zh") without needing a restart. Rebuilds the whole
/// menu (rather than relabeling items in place) since a `Submenu`'s own row
/// label doesn't reliably repaint from `set_text` alone on every platform.
#[tauri::command]
pub fn tray_set_language(app: AppHandle, state: State<'_, TrayState>, lang: String) -> Result<(), String> {
    let mut items = state.items.lock().map_err(|e| e.to_string())?;
    let lang = Lang::from_code(&lang);
    items.lang = lang;

    let (menu, toggle, prev, next) =
        build_menu(&app, lang, &items.now_playing, items.has_playlist).map_err(|e| e.to_string())?;
    items.tray_icon.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    items.toggle = toggle;
    items.prev = prev;
    items.next = next;

    Ok(())
}
