# Electron migration progress (scratch tracking, not code)

Actual code changes land in app/ per docs/electron-migration-handoff.md.
This folder just tracks task status across sub-agent dispatches.

- [ ] Task 0 - bridging Tauri release (on main branch, data safety) - FLAGGED, not auto-done
- [ ] Task 1 - Rust crate standalone build
- [ ] Task 2 - restore concurrency guarantees (native_audio mutex, spawn_blocking audit)
- [ ] Task 3 - Electron main + preload
- [ ] Task 4 - browser panel + tray in Node
- [ ] Task 5 - packaging (electron-builder)
- [ ] Task 6 - the two UI file edits
- [ ] bunx vitest run stays at 138 passing after each task
