/** YouTube link parsing, kept free of React so both the block component and
 *  the markdown transforms can use it (and so it is testable without a DOM). */

/** The eleven-character id out of any YouTube URL shape: watch links, short
 *  links, /embed/, /shorts/, /live/, and links carrying extra query
 *  parameters (timestamps, playlists, tracking). */
export function youTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com|youtube-nocookie\.com)\/watch\?(?:.*&)?v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /(?:youtube\.com|youtube-nocookie\.com)\/embed\/([\w-]{11})/,
    /(?:youtube\.com|youtube-nocookie\.com)\/shorts\/([\w-]{11})/,
    /(?:youtube\.com|youtube-nocookie\.com)\/live\/([\w-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function isYouTubeUrl(url: string): boolean {
  return youTubeId(url) !== null;
}
