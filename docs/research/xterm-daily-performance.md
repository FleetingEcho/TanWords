# Xterm daily-use performance review

Date: 2026-08-13

## Conclusion

TanWords' current **Automatic** renderer policy is the right default for daily use: WebGL for an opaque terminal and xterm's built-in DOM renderer for glass mode. DOM should be comfortable for ordinary Herdr use, including a 5,000-line xterm scrollback. WebGL remains the better choice for maximum headroom during dense, frequent full-screen redraws. There is no official quantitative result showing that DOM and WebGL perform equally, so an exact Herdr-specific comparison would require a replay benchmark in TanWords.

The setup is performance-conscious but not the absolute fastest possible opaque configuration. TanWords constructs every terminal with `allowTransparency: true`; xterm explicitly warns this can negatively affect performance. Keeping it enabled permits live glass/opaque switching without recreating xterm and the PTY session, so this is a reasonable continuity-versus-throughput tradeoff.

## Evidence

- TanWords resolves xterm 6.0.0 with WebGL addon 0.19.0, Fit addon 0.11.0, and Search addon 0.16.0 (`app/package.json`, `app/bun.lock`). Xterm 6 removed its canvas renderer and officially recommends either DOM or WebGL, confirming that both exposed choices are supported paths. [xterm 6.0.0 release](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0), [canvas-removal PR](https://github.com/xtermjs/xterm.js/pull/5105)
- Xterm describes WebGL as its optional GPU-accelerated renderer; the addon uses WebGL2. This supports using WebGL for the highest redraw headroom, although it does not quantify the gap for Herdr. [xterm repository](https://github.com/xtermjs/xterm.js), [WebGL addon documentation](https://github.com/xtermjs/xterm.js/blob/6.0.0/addons/addon-webgl/README.md)
- Xterm 5.3 made the default DOM renderer significantly faster. The implementation itself still describes DOM as the reliable fallback and says it is not intended to be particularly fast; it also rebuilds only the affected viewport row elements. DOM is therefore a reasonable daily renderer, while WebGL remains the safer performance choice for redraw-heavy TUIs. [xterm 5.3.0 release](https://github.com/xtermjs/xterm.js/releases/tag/5.3.0), [DOM renderer improvement PR](https://github.com/xtermjs/xterm.js/pull/4605), [xterm 6 DOM renderer source](https://raw.githubusercontent.com/xtermjs/xterm.js/6.0.0/src/browser/renderer/dom/DomRenderer.ts)
- TanWords' 5,000-line setting is five times xterm's 1,000-line default, but it controls retained buffer rows rather than the number of rows painted each frame. It increases buffer memory and the work of operations such as search, reflow, and resizing; no official source indicates that 5,000 is an excessive value. With the existing two-tab limit, TanWords retains at most roughly 10,000 scrollback rows across terminal tabs. [xterm 6 API: `scrollback`](https://github.com/xtermjs/xterm.js/blob/6.0.0/typings/xterm.d.ts#L246-L251)
- `allowTransparency` must be selected before `Terminal.open()` and cannot be changed live; the official API warns it can negatively affect performance. TanWords enables it unconditionally so the same live terminal can move between glass and opaque backgrounds. [xterm 6 API: `allowTransparency`](https://github.com/xtermjs/xterm.js/blob/6.0.0/typings/xterm.d.ts#L34-L40)
- Switching renderers is safe for scrollback and the shell session. Disposing the WebGL addon restores xterm's built-in renderer on the same Terminal instance rather than replacing its buffer. [WebGL addon source](https://github.com/xtermjs/xterm.js/blob/6.0.0/addons/addon-webgl/src/WebglAddon.ts#L91-L100)
- TanWords follows xterm's documented context-loss fallback by disposing WebGL. Xterm calls this easy approach “suboptimal”; after a GPU context loss, TanWords remains on DOM until a relevant setting, transparency, or session change reloads WebGL. [WebGL context-loss documentation](https://github.com/xtermjs/xterm.js/blob/6.0.0/addons/addon-webgl/README.md#handling-context-loss)

## TanWords-specific assessment

Several integration choices protect interactive responsiveness: xterm writes are serialized, pending decoded output is capped at 4 MiB, upstream output is suppressed when that cap is exceeded, and resize/refit work is coalesced to one animation frame and sent to the PTY only when columns or rows change. These are especially useful during large Herdr repaint bursts. The deliberate downside is that output can be truncated if xterm falls more than 4 MiB behind.

Recommended usage:

- Keep **Automatic** as the default.
- Use **DOM** with glass mode for normal Herdr sessions; it should be adequate unless actual frame drops or input lag are observed.
- Use an opaque background with **WebGL** for the most consistent performance during very dense redraws or unusually heavy output.
- Keep 5,000 scrollback. Herdr's own pane history and xterm's scrollback are separate; the configured buffer does not cause 5,000 rows to be repainted per frame.

## Follow-up worth measuring

If performance becomes perceptibly poor, record a fixed Herdr interaction and compare frame time, main-thread time, and memory under DOM versus opaque WebGL. That is the only reliable basis for tuning this particular workload. A more aggressive optimization would construct opaque terminals with `allowTransparency: false`, but supporting a later switch to glass would then require a lifecycle redesign that preserves the PTY while recreating only the xterm frontend.

Separately from renderer performance, an open upstream report claims xterm 6.0.0 can fail in DCS-using TUIs when its already-minified ESM is re-minified by Vite. This is not a maintainer-confirmed release finding, but packaged Herdr/TUI smoke tests should cover it. [xterm issue #5800](https://github.com/xtermjs/xterm.js/issues/5800)
