# MP4 Audio Scan Support

## Goal

Allow `.mp4` files in the configured music folder to appear in the music library so the user can test playback through the existing WebView audio player.

## Design

Add `mp4` to the backend `AUDIO_EXTENSIONS` allowlist used by `is_audio_file`. Keep the existing metadata extraction and `HTMLAudioElement` playback path unchanged.

MP4 is a container, so inclusion in the library does not guarantee that every MP4 audio codec is supported by the platform WebView. Unsupported codecs will continue to surface through the player's existing error state.

## Testing

Extend the music library scan test with an `.mp4` fixture and assert that it is included. Run the Rust music tests to verify extension filtering and existing scan behavior.

## Scope

This change does not inspect codecs, transcode files, add video playback, or alter the player UI.
