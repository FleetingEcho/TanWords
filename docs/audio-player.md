# The audio player

Everything known about how TanWords plays audio: the two playback paths, the
decode pipeline, how duration is determined, and — at length — the family of
truncation bugs that made songs stop early, because that history is the main
reason this subsystem looks the way it does.

Written 2026-07-28.

---

## 1. Two playback paths

There is one player UI and two completely different engines behind it. The
selector is a single field on the track:

```ts
interface PodcastTrack {
  audioUrl: string;      // enclosure URL, or asset:// for local files
  title: string;
  feedTitle: string;
  localPath?: string;    // present => native Rust engine; absent => <audio>
}
```

| | `localPath` set | `localPath` absent |
|---|---|---|
| Used for | local music library | remote podcast episodes |
| Engine | Rust: Symphonia decode + rodio/PulseAudio output | `HTMLAudioElement` in the WebView |
| Position/duration from | polling `native_audio_snapshot` every 250 ms | `timeupdate` / `durationchange` events |
| Ends via | snapshot `status === "ended"` | `ended` event |

Both write into the same Zustand store (`app/src/store/podcastPlayerStore.ts`),
so the bar, seek slider and queue logic are shared. **Any change to playback
behaviour has to be considered against both paths** — they fail differently and
have historically been fixed separately.

### Why a native engine exists at all

The WebView's own demuxer has the same duration bugs as the Rust ones (see §6),
and on Linux WebKitGTK cannot open Tauri's `asset://` scheme at all — its
GStreamer backend only understands http/https/file/blob/data, so
`<audio src="asset://...">` fails with `MEDIA_ERR_SRC_NOT_SUPPORTED`.
`lib/localAudioSrc.ts` works around that for the *remote* path by fetching the
URL and handing the element a `blob:` URL instead. Local music sidesteps the
WebView entirely.

---

## 2. File map

### Rust (`app/src-tauri/src/`)

| File | Responsibility |
|---|---|
| `native_audio/mod.rs` | Tauri commands, session state, `accurate_duration` |
| `native_audio/decoder.rs` | `FileDecoder` enum + `open_decoder` routing |
| `native_audio/robust.rs` | **The** decoder. Symphonia, all platforms |
| `native_audio/mp3_duration.rs` | Exact MP3 length by frame-header walk |
| `native_audio/mp4_duration.rs` | Exact MP4/M4A audio length from `mdhd`/`stts` or fragmented `sidx` |
| `native_audio/playback.rs` | The playback worker thread (two variants) |
| `native_audio/pulse.rs` | Linux-only PulseAudio output via `libloading` |
| `native_audio/coreaudio.rs` | macOS-only ExtAudioFile decoder (fallback) |
| `native_audio/gstreamer.rs` | Linux-only GStreamer decoder (fallback) |
| `native_audio/tests.rs` | Truncation regressions; builds fixtures with ffmpeg |
| `music.rs` | Library scan: walk, group, tags, duration |

### Frontend (`app/src/`)

| File | Responsibility |
|---|---|
| `store/podcastPlayerStore.ts` | All player state and both engine adapters |
| `features/music/queue.ts` | Play-mode logic (`nextIndexOnEnded` / `OnSkip`) |
| `lib/localAudioSrc.ts` | `asset://` → `blob:` workaround for WebKitGTK |
| `lib/audioChannel.ts` | Mutual exclusion between TTS and podcast players |
| `components/Music/musicLib.ts` | Duration backfill, `formatDuration` |
| `components/ui/PlayerBar.tsx`, `AudioSeekSlider.tsx` | UI |

---

## 3. Tauri commands

Registered in `lib.rs` (~line 233):

| Command | Async? | Notes |
|---|---|---|
| `music_scan_library` | yes | `spawn_blocking`; stateless, re-scans each visit |
| `native_audio_probe_duration` | yes | Duration only, no playback state |
| `native_audio_load` | **no** | Deliberately synchronous — see below |
| `native_audio_play` / `_pause` / `_seek` / `_set_speed` / `_stop` | no | Send a `Command` down the session channel |
| `native_audio_snapshot` | no | Returns the shared `NativeAudioSnapshot` |

### Why `native_audio_load` is *not* `#[tauri::command(async)]`

Between taking the old session and installing the new one there is a window
where `session` is `None`. A `native_audio_stop` landing inside that window
would be silently dropped and the old track would keep playing. Running on the
main thread keeps the swap atomic against the other session commands. The
frontend's `loadChain` serialization assumes this.

`native_audio_probe_duration` *is* async for the opposite reason: a plain
command runs on the main thread, which on Linux is the GTK/WebKit UI thread, and
opening a decoder there froze the window while the music library backfilled
durations.

### Snapshot and generations

```rust
struct NativeAudioSnapshot {
    status: "idle" | "playing" | "paused" | "ended" | "error",
    position_sec: f64, duration_sec: f64, speed: f32,
    error: Option<String>, generation: u64,
}
```

Each load increments `generation`. A worker whose generation no longer matches
the shared snapshot returns immediately — that is how an orphaned worker from a
superseded load stops itself.

---

## 4. The playback worker

`playback.rs` has two entirely separate implementations.

### Non-Linux (Windows, macOS)

Wraps the decoder in `rodio::Player` on the default device sink. The loop polls
commands with a 20 ms timeout, mirrors `player.get_pos()` into the snapshot, and
returns when `player.empty()`.

**Important:** rodio's mixer wraps every appended source in a
`UniformSourceIterator` (`rodio-0.22.2/src/mixer.rs:62`). That wrapper drives
the decoder span-by-span and imposes a contract most decoders get wrong — see
§7.4, which is where the last and worst truncation bug lived.

### Linux

Does **not** use rodio for output. It writes PCM straight to PulseAudio through
`pulse.rs` (loaded via `libloading`, no build-time dependency) and:

- keeps its own frame counter as the authoritative clock,
  `position = frames/rate - output.latency()`;
- implements speed itself in `resample_speed` (nearest-sample, no pitch
  correction);
- on pause, flushes the output and *re-seeks the decoder* to the audible
  position, so the buffered-but-unheard audio is not skipped on resume.

This exists because the Linux stack needed latency-aware position reporting that
rodio did not give.

---

## 5. Decoder selection

```rust
pub(super) fn open_decoder(path: &Path) -> Result<FileDecoder, String>
```

Order:

1. **`RobustDecoder`** (Symphonia) — every format, every platform.
2. `GstreamerDecoder` (Linux) / `CoreAudioDecoder` (macOS) — only if 1 failed to
   *open*. Their real remaining value is codecs Symphonia lacks, chiefly **ALAC**
   in `.m4a` on macOS.
3. `rodio::Decoder` — last resort.

This ordering is the point. Previously each platform got its own native decoder
as the *primary* path for MP3/MP4, which meant three decoders that could
disagree, and whichever platform had not been patched yet still ran the buggy
rodio path. Fixing the shared decoder instead means there is one code path to
reason about and to test.

### What `RobustDecoder` does that `rodio::Decoder` does not

- **Pins the audio track.** Picks the default track if it is decodable audio,
  else the first track a codec can be built for. Symphonia's registry holds only
  audio codecs, so "a codec can be made" *is* the audio-track test. Then it skips
  every packet whose `track_id` differs.
- **Classifies errors** into recover-and-continue vs. genuine end of stream,
  instead of ending on all of them.
- **Rebuilds the codec** on a mid-stream spec change.
- **Disables MP3 gapless trimming** because old files can carry corrupt LAME
  trim metadata even when their Xing frame count is trustworthy.
- **Never reports an empty span** while audio remains.

---

## 6. Duration: one source of truth

`native_audio::accurate_duration` ranks sources by *how the number is arrived
at*, not by which library produced it:

1. **MP3 → measured from the bitstream** (`mp3_duration.rs`).
2. **MP4/M4A → container timing boxes**: `mdhd`/`stts` for ordinary files,
   `sidx` for fragmented files whose media header and sample table are empty.
3. **Container-declared length** from the decoder (FLAC/Ogg and ordinary
   containers write an exact frame count in the header).
4. **`lofty` tag metadata**, for anything the earlier sources cannot parse.

The result is pushed back into the decoder via `set_total_duration`, so seek
clamping uses the same number the UI displays.

`music.rs` uses the same measurement for the library list, so the list and the
player cannot disagree.

### Why MP3 needs its own measurement

Every other MP3 duration source is an extrapolation:

- **`lofty`**, with no Xing/VBRI header, takes the *first frame's* bitrate and
  divides file size by it — it logs `"MPEG: Using bitrate to estimate duration"`.
- **Symphonia** averages its *first 16 frames* and extrapolates
  (`estimate_num_mpeg_frames`).
- **ffprobe** does the same thing and is wrong on the same files.

Exact for CBR; badly wrong for VBR without a Xing header.

`mp3_duration.rs` walks every frame header — 4 bytes per frame plus a buffered
seek over each frame body, never decoding — and sums the exact sample count.
**Measured cost: 1.37 ms for a 4-minute file.** That is cheap enough that there
is never a reason to prefer an estimate, and cheap enough to also run as a
cross-check on the encoder's own declared count.

It handles: leading ID3v2 (incl. footer flag), trailing ID3v1 and APEv2,
Xing/Info and VBRI headers, the silent tag frame (excluded — it is not music),
mixed MPEG versions/layers, and resync across mid-file garbage.

**A Xing count is verified, not trusted.** When two MP3s are concatenated the
first file's Xing header survives at the top of the joined file and describes
only its own part. `Scan::declared_matches` is true only when the declared count
agrees with the walk (± 2 frames of slack). This drives both the reported
duration *and* whether gapless trimming is enabled.

---

## 7. The truncation bug family

The recurring "a 4:00 song stops at 3:12 and skips to the next track" report was
never one bug. It was five, and the fixes for the first ones were routed around
per-platform rather than fixed at the source — which is why it kept reappearing
on whichever OS had not been patched yet.

Measured against ffmpeg-built fixtures, before any fix:

| fixture | true length | `lofty` said | rodio decoded |
|---|---|---|---|
| song shipped as `.mp4` (video + audio track) | 120 s | — | **0.05 s** |
| VBR mp3, no Xing header | 240 s | **39.8 s** | **181.3 s** |
| VBR mp3, dense intro | 240 s | **10.5 s** | **20.0 s** |
| two mp3s concatenated | 120 s | **60.0 s** | **60.0 s** |

### 7.1 Foreign track packets fed to the audio decoder

`rodio`'s `Iterator::next` never checks `packet.track_id()`, though its *init*
path carefully does. In an MP4 with video, the first video packet goes to the
audio decoder, which errors, and `Err(_) => return None` ends the track.
**0.05 s of a two-minute song.**

Fix: pin the track, skip foreign packets.

### 7.2 Gapless trimming to a *guessed* frame count

Symphonia's gapless mode drops encoder delay/padding — but implements the tail
trim by cutting the stream at the track's declared `n_frames`. For MP3 without a
Xing header there is no declared count, so it extrapolates one from the first 16
frames and then truncates playback *to the guess*.

This is the single largest contributor to the classic symptom, and it is
invisible when testing with CBR or Xing-tagged files, which is most files.

Fix: `gapless_is_safe()` leaves gapless mode on for non-MP3 containers, but off
for every MP3. Cross-checking Xing/VBRI counts is still required for duration,
but it is not sufficient for trimming: this concert recording has a correct
frame count beside corrupt LAME trim metadata, and Symphonia cuts it at 3:27
when gapless mode is enabled. Cost of off: up to ~26 ms of padding at each end.
Cost of on with bad metadata: the rest of the song.

### 7.3 Mid-stream spec change kills the decoder permanently

Symphonia's MP3 decoder allocates its output buffer from the first frame it sees
and then rejects *every* later frame whose spec differs, with a plain
`DecodeError` and **never** a `ResetRequired`:

```
mpa: invalid audio buffer signal spec for packet
```

So after a concatenation join or a station-ID splice, every packet fails and the
track appears to end — even though the demuxer happily reads on to the true end
of file (verified: 3966/3966 packets read, all rejected after the join).

Fix: on a decode failure, build a *fresh* codec once and retry the same packet.
A new decoder has no buffer yet and adopts the spec from the next frame header,
which is exactly the recovery needed. For MPEG audio the authoritative spec is
in the frame header, not the container.

### 7.4 A zero-length span ends the track — *the one that survived*

This is the most important entry, and the one that caused the "duration is
right, but it jumps to the next song at 3:27" report.

rodio's mixer wraps every source in `UniformSourceIterator`, which resamples one
span at a time (`rodio-0.22.2/src/source/uniform.rs`):

```rust
let span_len = input.current_span_len().map(|x| x.min(32768));
let input = Take { iter: input, n: span_len };   // drain, then re-read the length
```

All three decoders reported `Some(buffer.len() - offset)` — "however much is left
in my decode buffer". When a span boundary lands exactly on a decode-buffer
boundary, that re-read returns `Some(0)`, rodio builds `Take { n: 0 }`, which
yields nothing, and **the track is declared finished mid-song** with the decoder
still holding the rest of the file. The frontend then advances the queue.

Whether it fires depends on how the file's sample rate divides against the
output device's rate. That is why it landed on a different second in every song,
and why it looked platform-specific: **`robust.rs`, `coreaudio.rs` and
`gstreamer.rs` all had it**, so every platform-specific "fix" carried the same
latent defect forward.

Measured through rodio's real path, before the fix:

| fixture | direct iteration | through the mixer |
|---|---|---|
| vbr_xing.mp3 | 240.00 s | **0.00 s** |
| vbr_noxing.mp3 | 240.04 s | **0.03 s** |
| music_video.mp4 | 120.02 s | **0.02 s** |

Fix: eagerly decode the next span at the end of `next()`, in all three decoders,
so an empty span genuinely means end of file.

### 7.5 `n_frames` read from the wrong track

rodio takes the time base from the first supported track but the frame count
from the container's *default* track — which in a music video is the video
track. `select_audio_track` takes both from the chosen audio track.

---

## 8. Invariants — do not break these

1. **`current_span_len()` must never return `Some(0)` while audio remains.**
   rodio turns it into `Take { n: 0 }` and ends the track. Any new decoder, or
   any change to buffering in an existing one, has to preserve this. There is a
   test that states the contract directly.
2. **Test decoders through `UniformSourceIterator`, not by direct iteration.**
   A decoder can satisfy `Iterator` perfectly, return every sample of a
   four-minute file on direct iteration, and still yield 0.02 s in real
   playback. Direct-iteration tests cannot see §7.4 at all.
3. **Duration must never come from a bitrate extrapolation.** Measure, or read a
   container-declared exact count. Never divide file size by a bitrate.
4. **Do not trust a Xing/VBRI count without cross-checking it** against the
   bitstream. Concatenated files carry a stale one.
5. **Do not enable MP3 gapless trimming solely because the frame count is
   valid.** LAME trim metadata can be corrupt independently.
6. **Keep `native_audio_load` synchronous.** See §3.
7. **Keep the fallback decoders as fallbacks.** Routing a format to a native
   decoder as the *primary* path is what created the whack-a-mole in the first
   place.
8. **`accurate_duration` is the single source of truth.** The library list and
   the player must call the same thing or they will drift apart again.

---

## 9. Frontend behaviour worth knowing

### Load serialization

Tauri does not guarantee concurrent invocations settle in issue order, and
`open_decoder` takes longer for some files than others. Firing
`native_audio_load` for a new track while a previous call for a *different*
track was in flight let the stale call's session-replace win: the bar showed the
new title while the old track kept playing — the "song and name don't match"
bug. Every `playAt()` goes through `loadChain`, and a call is skipped outright
if a newer one was queued behind it before its turn came.

### Play modes (`features/music/queue.ts`)

`order` | `loop-one` | `loop-all` | `shuffle`.

`nextIndexOnEnded` and `nextIndexOnSkip` differ deliberately: under `loop-one` a
track that ends replays itself, but clicking *next* moves on. Shuffle draws from
the other `length-1` slots so it never repeats the current track.

### Infinite duration on remote podcasts

Some enclosures (chunked transfer, no `Content-Length`) report `duration` as
`Infinity` until playback reaches the end. The `loadedmetadata` handler seeks to
`1e101` to force the browser to resolve the real duration, then snaps back —
with `resolvingDuration` suppressing position updates so the bar does not visibly
jump.

### Other

- TTS and podcast players share the bottom bar; starting one fully stops the
  other (`audioChannel` alone would only pause it).
- Speed is clamped to 0.5–2.0 in Rust.
- WebKitGTK does not reliably re-fire `playing` after a seek-triggered stall, so
  `seeked`/`canplay` are used as fallbacks to clear the spinner.

---

## 10. Library scan (`music.rs`)

- Extensions: `mp3, wav, m4a, mp4, flac, ogg, aac`.
- Grouped by **first-level subfolder**; loose root files go to a `""` collection
  rendered last.
- Tags via `lofty`, duration via `measured_mp3_duration_secs` falling back to
  `lofty`.
- **GBK mojibake repair** (`fix_legacy_encoding`): ID3 tags written by Chinese
  rippers are usually GBK bytes that the spec decodes as Latin-1, giving
  `"ÖÜ½ÜÂ×"` for `"周杰伦"`. If every char fits in Latin-1 and the bytes
  round-trip cleanly through GBK, the GBK reading wins; real Western text is left
  alone.
- Stateless by design — re-scanned per page visit, so no cache invalidation.

---

## 11. Testing

`native_audio/tests.rs` **builds its own fixtures with ffmpeg** and skips if
ffmpeg is absent. This is deliberate: the older tests pointed at MP3s on one
developer's disk (`/home/zteng/...`, `/Users/tengzhang/...`) and silently
returned on every other machine, which is part of why this kept shipping broken.

Fixtures and what each one catches:

| fixture | catches |
|---|---|
| `music_video.mp4` | §7.1 foreign-track packets |
| `fragmented-duration.mp4` | empty `mdhd`/`stts`, real duration in `sidx` |
| `vbr_noxing.mp3` | §7.2 gapless-to-a-guess, and the duration estimate |
| `mixed_rate.mp3` (two rates concatenated) | §7.3 spec change, §6 stale Xing |
| `played.mp3` / `played.mp4` via `played_secs` | §7.4 the span contract |
| `span.mp3` | §7.4 stated directly as an invariant |
| `seekable.mp3` | seek accuracy, and playing on to the real end afterwards |

`mp3_duration.rs` has its own pure-Rust unit tests that synthesize MPEG frames
byte by byte — no ffmpeg, no fixtures.

### ⚠️ The test binary does not currently run on Windows

`cargo test --lib` fails with `STATUS_ENTRYPOINT_NOT_FOUND` (exit `0xc0000139`)
from the sherpa-rs / onnxruntime DLLs, **before any test executes**. This
reproduces on a clean `git stash`ed tree, so it predates the audio work and is
unrelated to it. It means the audio tests, though committed, have not been run
by the repo's own harness on this machine.

They were instead verified by an isolated crate that pulls the same source files
in via `#[path]` and depends only on `rodio` + `symphonia` + `lofty`. 16/16 pass.
Worth reproducing that harness, or fixing the DLL fault, before trusting a green
CI run here.

---

## 12. Known gaps and risks

- **`coreaudio.rs` and `gstreamer.rs` changes are unverified by execution.** The
  §7.4 span fix was applied to both, mirroring the verified `robust.rs` change,
  but neither compiles on Windows. Build on macOS and Linux before shipping.
- **Linux `resample_speed` is nearest-sample**, so non-1.0 speeds change pitch
  and alias. Fine for speech, poor for music.
- **`MAX_CONSECUTIVE_ERRORS = 4096`** bounds recovery. A file with a longer
  unbroken damaged run will still end early — a deliberate trade against
  spinning forever.
- **Position reporting across a mid-stream sample-rate change** is approximate:
  the non-Linux worker reads `rodio::Player::get_pos()`, which does not know the
  rate changed. Rare, and only affects concatenated files.
- **Gapless is off for every MP3**, costing up to ~26 ms of padding at each
  end. Deliberate; see §7.2.
- **The library scan re-runs on every visit.** Fine for hundreds of files; a
  five-figure library would want caching.
- **Duration is measured twice at load** — once when constructing the decoder
  and once by `accurate_duration`, which pushes the same value back into it.
  About 3 ms total, not worth coupling the two paths to optimize away.
