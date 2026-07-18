# Sidebar GitHub Link

## Goal

Give users a persistent, low-friction way to open the TanWords GitHub repository.

## Design

Add a GitHub button to the global sidebar footer above Update and Settings. It follows the existing sidebar item styling, shows a label when expanded, and becomes an icon-only button with a tooltip when collapsed.

Clicking opens `https://github.com/FleetingEcho/TanWords` in the system browser through the Tauri shell plugin, with `window.open` as a web-mode fallback. The link does not participate in application navigation state.
