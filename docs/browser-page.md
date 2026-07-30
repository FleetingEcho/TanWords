# The in-app Browser page

How the Browser page embeds a real website inside TanWords, and the layout
bug we chased across this whole investigation — where it actually turned out
to live, and what's still unresolved.

Written 2026-07-30.

---

## 1. Why a native child webview, not an `<iframe>`

`app/src-tauri/src/browser_panel/mod.rs` creates a single native child
`WKWebView` (`Window::add_child`) layered over the main window, rather than
an `<iframe>` in the DOM. Most real sites (X included) send
`X-Frame-Options`/`frame-ancestors` headers that block iframe embedding
outright; a child webview is a separate top-level navigation, so it isn't
subject to that at all.

Only one panel exists at a time. It's created lazily on first
`browser_show` and then just repositioned/shown/hidden after that, so
switching away from and back to the Browser page doesn't tear down the
session — cookies/login/scroll position survive. The Browser *page* itself
(the React component) unmounts/remounts across navigation and loses its own
state, so the panel's last known url/title live in Rust (`BrowserPanelState`)
and get read back via `browser_get_state` on mount.

Frontend piece: `app/src/components/Browser/BrowserPage.tsx` (toolbar +
mount-point div) and `useBrowserPanel.ts` (owns the panel's lifecycle —
measuring the mount-point div's `getBoundingClientRect()` and sending that
to Rust as the panel's bounds).

## 2. The bug as reported

Opening any site (google.com, x.com, ...) rendered the native panel
starting too high — it visually covered BrowserPage's own toolbar (the
back/forward/reload buttons and address bar), leaving only a sliver of the
address input's rounded corner peeking out just below the app's global
`CommandBar` header.

## 3. What we ruled out (with proof, not guesses)

This took multiple rounds because every plausible cause turned out, on
inspection, to be fine:

- **A real race condition, fixed but not the cause here.** `browser_show`'s
  reposition branch and `browser_set_bounds` originally called
  `webview.set_position(...)` then `webview.set_size(...)` as two separate
  Tauri calls. On macOS each of those does a read-current-bounds →
  patch-one-field → write-back internally, and the position math flips Y
  using the view's *current* height (AppKit views are bottom-left-origin
  unless flipped) — so calling them back to back applies the new position
  against the stale old height for one frame. This is a real bug and was
  fixed by switching to the atomic `webview.set_bounds(Rect { position, size
  })` call at both sites. It did **not** fix the reported symptom, because
  the symptom also reproduced on a freshly-created panel, which doesn't go
  through that code path.

- **Frontend layout math.** Loaded the exact same app in a plain Chrome tab
  against the Vite dev server (`localhost:5420`), forced the sidebar tabs
  via `localStorage`, and measured the real DOM: header ends at `48px`,
  BrowserPage's own toolbar ends at `97px` — and `container.getBoundingClientRect().top`
  is exactly `97`. That number is what gets sent to Rust.

- **Native placement.** Added debug logging
  (`[browser_panel] created/readback (physical) pos=... size=... window_inner=... scale=...`)
  and confirmed a perfect, zero-error round-trip: requested logical
  `(60, 97, 1141, 672)` at `scale=2.0` produced physical `pos=(120, 194)
  size=(2282, 1344)` — exactly `2×` the requested logical values, both
  times it was checked (once at `h=411`, once at `h=672`). Also independently
  re-derived this from a real screenshot: calibrated the screenshot's pixel
  scale using the sidebar's known 60px logical width (found its edge at
  screenshot x≈101, giving scale≈1.667), then confirmed the black
  (page) region starts at screenshot y≈162, matching `97 × 1.667 ≈ 162`
  almost exactly. **The native panel is positioned exactly where the DOM
  says it should be.** Also checked `tao`'s source directly to rule out a
  stale window-handle theory (`ns_view()` re-queries `ns_window.contentView()`
  live on every call, so it can't be pointing at a stale/replaced content
  view).

- **CSS height of the toolbar row.** Made the row's height explicit
  (`h-12` instead of implicit `py-2` + `h-8` children) — no visible change,
  because both computed to the same 48px. Temporarily painted the row
  bright red as an unambiguous visual probe: **the row is exactly the
  right size and position.** But red-with-no-icons showed the row was
  rendering empty, not mispositioned.

- **A pure React/CSS bug.** Reproduced the "open a URL" flow in the same
  Chrome tab with **zero native webview involved** (stubbed
  `window.__TAURI_INTERNALS__.invoke` so the app's `open()` flow completes
  without erroring). Result: address bar renders fully, populated with the
  URL, correctly positioned. So the component code, in isolation, is fine.

## 4. What's actually happening

Comparing two real screenshots of the live app:

- **Before opening a URL** (`opened === false`): toolbar fully visible —
  back/forward/reload icons, "Search or enter a URL" input, trash icon.
- **After opening x.com** (`opened === true`, native panel now shown):
  same position, same size, but the row renders **completely empty** — no
  icons, no input outline at all.

Combined with §3, the only variable that changed is whether the native
child `WKWebView` has actually been shown as a sibling `NSView`. That's a
macOS/WebKit compositing interaction, not a bug in this codebase's
position math or CSS: inserting a new native sibling view appears to leave
some of the main webview's GPU-layer-promoted DOM content (the toolbar's
buttons and input all use `transition-colors`, which typically gets
promoted to its own Core Animation layer) positioned correctly but
**unpainted**, until something else forces a recomposite.

## 5. Current mitigation (unverified in the live app)

Added a `forceRepaint()` nudge in `useBrowserPanel.ts`, called right after
the panel is shown/repositioned:

```ts
const forceRepaint = () => {
  const el = document.documentElement;
  const prev = el.style.transform;
  el.style.transform = "translateZ(0)";
  void el.offsetHeight;
  requestAnimationFrame(() => { el.style.transform = prev; });
};
```

Toggling a transform on the root element is the standard nudge for this
class of WebKit "layer positioned but not repainted" bug. This has **not
yet been confirmed to fix it** in the real app — that's the next thing to
check.

## 6. If `forceRepaint()` doesn't fully fix it

Things worth trying next, roughly in order of how non-invasive they are:

- Force the repaint from the **Rust side** right after `webview.show()`,
  instead of (or in addition to) the frontend nudge — e.g. toggling the
  main window's own size by ±1px and back, or an explicit
  `setNeedsDisplay`-equivalent on the main webview's `NSView` if `wry`
  exposes one.
- Try repainting a narrower target than `document.documentElement` (e.g.
  just the toolbar row) in case toggling the whole page's transform has
  side effects elsewhere (scroll position, existing CSS transitions
  firing).
- Check whether this is a known upstream `tauri`/`wry` issue — nothing
  found in a search that matched this exact symptom (sibling DOM content
  going blank when a child webview is shown), so it may be worth filing
  one with the repro in §4 if it recurs after the mitigation.
- Worth confirming whether removing `transition-colors` from the toolbar's
  buttons/input (i.e. not GPU-promoting them) also avoids the bug — if so,
  that's a strong confirmation of the layer-promotion theory in §4, though
  removing the transition everywhere isn't a real fix, just a diagnostic.
