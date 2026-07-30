# The in-app Browser page

How the Browser page embeds a real website inside TanWords, and the layout
bug we chased across this whole investigation — where it actually turned out
to live, and what's still unresolved.

Written 2026-07-30.

---

## 1. Why native child webviews, not `<iframe>`s

`app/src-tauri/src/browser_panel/mod.rs` creates native child `WKWebView`s
(`Window::add_child`) layered over the main window, rather than `<iframe>`s
in the DOM. Most real sites (X included) send
`X-Frame-Options`/`frame-ancestors` headers that block iframe embedding
outright; a child webview is a separate top-level navigation, so it isn't
subject to that at all.

One webview per tab, all siblings in the main window, with exactly one
visible at a time — `browser_show` reveals its target and hides every other,
because a child webview renders as a native layer above the window's HTML
and two visible at once would simply stack. Tabs are created lazily and then
only repositioned/shown/hidden, so switching tabs (or leaving the Browser
page and coming back) never tears down a session: cookies, login and scroll
position survive.

**Tab identity lives in Rust, not the frontend.** The Browser *page* (the
React component) unmounts/remounts across navigation and loses its state,
while the webviews stay alive. `browser_get_state` returns every live tab in
strip order plus which is active, so a remounted page rebuilds its whole tab
bar; a frontend-side id counter would restart from scratch and collide with
webview labels that still exist.

Frontend pieces: `BrowserPage.tsx` (tab strip + toolbar + mount-point div),
`BrowserTabStrip.tsx`, and `useBrowserPanel.ts` (owns lifecycle — measuring
the mount-point div's `getBoundingClientRect()` and sending that to Rust as
the bounds). A single effect in the hook reconciles the native side to
React state: tab switches and the home button only set state, and that
effect reveals or hides the right webview afterwards.

A tab's home screen is a *hidden*, not closed, webview
(`browser_go_home`), so the session survives; the address and title clear
with it. That state is recorded in Rust rather than only in React, because
the page remounts across navigation and would otherwise resurrect the site
a tab had explicitly been sent home from. `browser_close_tab` is the one
that actually destroys a webview.

### Overlays have to make the panel step aside

A child webview is a real `NSView` composited **above every pixel of this
document**, so no `z-index` can put a modal in front of it — the Tools
window, word-detail dialogs and dropdowns all rendered behind the page.

`src/store/browserPanelStore.ts` is a counter of "overlays currently on
screen". `useBrowserPanel` hides every tab while it is non-zero and
re-shows the active one when it drops back to zero (natively just
`setHidden`, so scroll position and in-page state survive). Overlays opt in
by rendering `<BrowserPanelBlocker />`, which blocks for as long as it stays
mounted.

Wired into the shared primitives — `ui/dialog.tsx` (covers ConfirmModal,
WordDetailModal, anything else on `Dialog`), `dropdown-menu`, `popover`,
`select` — plus the hand-rolled `ToolsModal`, `TranslateModal` and
`NowPlayingOverlay`. In the Radix ones the blocker goes inside `Content`,
not `Portal`: Radix wraps each `Portal` child in `Presence` + `Slot`, which
needs a ref-able element, and a component rendering `null` warns there.
`Content` mounts only while open, which is exactly the lifetime wanted.

Deliberately a registry rather than a DOM scan for fixed-position elements:
overlays here are heterogeneous, and a detector would have to guess which
ones matter while excluding `AppBackground` (fixed, but behind everything).
It also lets toasts stay excluded on purpose — blanking the page for four
seconds would be worse than the overlap.

Consequence worth knowing: opening a modal makes the embedded page visibly
disappear for as long as it's up. That's the trade — the alternative is an
invisible modal.

### The ask pane

`BrowserAskPane` docks to the right of the page: text goes in, the same
answers the in-app selection toolbar gives come out.

**Text is pasted in, not read out of the page.** The app's `SelectionAsk`
binds to `document` in the main webview and the embedded page is a separate
`WKWebView` with its own document and process, so it can never see a
selection there. A bridge is possible — `eval_with_callback` can pull
`getSelection()` across — but it was built and then removed as more
machinery than the job needs. Copy from the page, paste in the pane.

Worth recording in case it's revisited: if that bridge ever comes back, it
must stay a *pull* from Rust. Tauri withholds `__TAURI_INTERNALS__` from
remote URLs, and injecting a script that pushes over IPC would hand every
site you browse the ability to invoke this app's commands.

**Docked, not floating**, for the compositing reason above: a card over the
page would be invisible, and hiding the panel to show one would take away
the text being discussed. The placeholder simply gets narrower and the
existing ResizeObserver repositions the webview — which is also all the
drag-to-resize handle does, so it needs no bookkeeping of its own. Width
persists in `localStorage`, clamped to leave the page at least 320px.

Buttons follow the same grammar as `SelectionToolbarButtons`, so a slot
means the same thing in both places: a sentence gets a plain rendering and a
follow-up question, a word gets its meaning in context and the full card.
The answer is the same `InlineAskPanel` (`layout="inline"`), so streaming,
add-to-vocabulary and save-sentence all behave identically — those two live
in its footer, i.e. they're offered after an answer rather than up front.

### Where the address bar's value comes from

`on_page_load`, **not** `on_navigation`. wry wires `on_navigation` to
WebKit's `decidePolicyForNavigationAction`, which fires for *every frame*,
and it discards `action.targetFrame.isMainFrame` before handing over the
URL — so there is no way to tell a top-level navigation from an iframe's.
Trusting it meant any embedded widget captured the address bar: a page
carrying a Google Sign-In button parked
`accounts.google.com/gsi/button?...` there.

`on_page_load` is driven by the main frame's own load events and can't be
spoofed by a subframe, so it is the authority. `on_navigation` is still
used, but only for what `on_page_load` structurally misses: same-document
navigation (`pushState`/`replaceState`/hash), which SPAs use constantly and
which fires no load event. Those are always same-origin with the loaded
page, so `accept_soft_navigation` accepts only same-origin URLs. Residual
gap: a same-origin subframe can still nudge the bar — better than an
address that goes stale the moment you click anything inside an SPA.

Two overlapping data-clearing actions, both hitting the single
`WKWebsiteDataStore` shared by every tab, so both are global rather than
per-tab: `browser_hard_reload` (wipe cookies/localStorage/cache, then
reload the tab) and `browser_clear_data` (wipe only, no reload — behind a
confirm dialog).

## 2. The bug as reported

Opening any site (google.com, x.com, ...) rendered the native panel
starting too high — it visually covered BrowserPage's own toolbar (the
back/forward/reload buttons and address bar), leaving only a sliver of the
address input's rounded corner peeking out just below the app's global
`CommandBar` header. The panel also stopped short of the window's bottom
edge by the same amount.

## 3. Root cause: two different coordinate spaces

`getBoundingClientRect()` measures in **DOM viewport** coordinates. A child
webview is positioned in the window's **native content-area** coordinates.
On macOS those two do not share an origin, and the frontend was passing the
former straight through as the latter.

Measured live in the running app (1200x800 window, `scale=2.0`):

| | logical size | origin of y=0 |
|---|---|---|
| Window content area / main webview `NSView` | 1201 x **801** | top of the window frame |
| DOM viewport (`innerHeight`, `documentElement.clientHeight`) | 1201 x **769** | 32px lower |

The 32px is the title bar. `tao` gives the window a full-size content view,
so the main `WKWebView`'s `NSView` spans the entire 801px frame — but
`WKWebView` insets its own *web content* by the title bar height, which is
why the app's own layout starts at native y=32 and the DOM only ever sees
769 usable pixels.

So when BrowserPage measured its placeholder at `rect.top = 96` (48px
`CommandBar` + 48px toolbar) and sent `y=96`, wry placed the panel 96px
below the top of the *window frame* — i.e. at DOM y=**64**. The toolbar row
occupies DOM y 48..96 and the address input y 56..88, so the panel's top
edge landed 8px into the input: exactly the "sliver of a rounded corner"
symptom. The same shift left the panel's bottom at DOM y=737 instead of
769, 32px short — the "height isn't controllable" half of the report.

Verified by instrumenting both sides at once: the frontend encoded its own
viewport metrics into the URL it opened, which `browser_show` already logs,
while a temporary loop printed every sibling webview's native frame. That
put `innerH=769` and `main pos=(0,0) size=1201x801` on adjacent lines of the
same log.

## 4. The fix

`useBrowserPanel.ts` translates the placeholder's viewport rect into native
content-area coordinates before sending it, via `viewportOffsetY()`:

```ts
const [size, scale] = await Promise.all([win.innerSize(), win.scaleFactor()]);
return Math.max(0, Math.round(size.height / scale - window.innerHeight));
```

The offset is **derived, never hardcoded**: it is 0 on Windows/Linux and in
fullscreen, and it follows whatever title bar style the window ends up with.
It is cached for 250ms because the resize path re-measures on every observed
frame and this costs two IPC round-trips. Only `y` needs correcting — `x`
and the width/height are already identical in both spaces, and shifting the
origin down by 32 puts the panel's bottom exactly on the content-area edge.

Result: `show x=60 y=128 w=1141 h=673` (96+32, bottom at 801), toolbar fully
visible, panel flush to the window's bottom and right edges.

## 5. Things that turned out not to be the cause

Recorded because each looked convincing and cost a round of investigation:

- **The toolbar "rendering empty" is not a WebKit repaint bug.** An earlier
  pass concluded that inserting a sibling native view left the toolbar's
  GPU-promoted layers positioned-but-unpainted, and added a
  `forceRepaint()` transform nudge on `document.documentElement`. The row
  was not unpainted — it was covered by the panel, which had loaded a
  white page over a light-themed toolbar. That mitigation has been removed;
  toggling a transform on the root element is not free (it creates a
  containing block for fixed-position descendants).

- **Screenshot calibration "confirming" correct placement.** A pixel
  measurement off a screenshot put the panel's top at y≈97, apparently
  matching the requested 97. The estimated scale factor (≈1.667, derived
  from the sidebar's 60px width) carried enough error to hide a 32px
  discrepancy. Reading the numbers out of both runtimes beat measuring
  pixels.

- **A real race condition, fixed but unrelated.** `browser_show`'s
  reposition branch and `browser_set_bounds` originally called
  `set_position` then `set_size` as two separate Tauri calls. On macOS each
  does a read-current-bounds → patch-one-field → write-back internally, and
  the position math flips Y using the view's *current* height — so back-to-back
  calls apply the new position against the stale old height for one frame.
  Both sites now use the atomic `set_bounds(Rect { position, size })`. This
  is worth keeping, but it never affected a freshly-created panel.

- **Frontend layout math and toolbar CSS.** Both check out: the row is
  exactly 48px, `container.getBoundingClientRect().top` is exactly 96, and
  reproducing the open-a-URL flow in plain Chrome with the native webview
  stubbed out renders the address bar correctly.

## 6. If you touch this again

The invariant to preserve: **anything measured with
`getBoundingClientRect()` must be offset by `viewportOffsetY()` before it
reaches `browser_show` / `browser_set_bounds`.** `currentBounds()` is the
single place that conversion happens; keep it that way rather than
adjusting at individual call sites.
