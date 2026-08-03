/** Extensions the music scanner accepts that are really video containers.
 *
 *  `core/src/music.rs` scans mp4 as an *audio* container (m4a and friends
 *  share it), so a video file lands in the library and plays as a track with
 *  no picture — Symphonia decodes the audio stream and ignores the rest. The
 *  library still lists it; it just also offers to open it in a real player. */
const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|mkv|webm|avi|wmv|flv|mpg|mpeg)$/i;

export function isVideoFile(path: string): boolean {
  return VIDEO_EXTENSIONS.test(path);
}
