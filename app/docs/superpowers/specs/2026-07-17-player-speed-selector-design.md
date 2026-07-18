# Player Speed Selector

## Goal

Keep the full-screen play/pause control geometrically centered and reduce horizontal pressure in the compact Podcast/Music player.

## Design

Replace the four always-visible speed buttons with a shared selector that displays the current speed and opens an upward menu. The selector closes after selection, on outside click, or on Escape.

The full-screen transport uses five symmetric columns: play mode, previous, play/pause, next, and speed. The outer controls have equal widths, keeping play/pause at the exact horizontal center. The compact player uses the same selector with its card styling.

## Scope

This applies to the Podcast/Music player and its full-screen overlay. The sentence-based TTS player remains unchanged.
