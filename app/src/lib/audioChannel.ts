/** Module-level registry so only one audio source plays at a time across the
 * whole app: the article player (PlayerBar) and any individual SpeakButton
 * stop each other rather than overlapping. */
type StopFn = () => void;

let current: StopFn | null = null;

/** Registers `stop` as the active audio owner, evicting whatever was
 * playing before it. Call this right before you start playback. */
export function claimAudioChannel(stop: StopFn): void {
  const previous = current;
  current = stop;
  if (previous && previous !== stop) {
    previous();
  }
}

/** Called by the current owner when it stops on its own (e.g. finished
 * playing) so a stale reference doesn't later stop an unrelated owner. */
export function releaseAudioChannel(stop: StopFn): void {
  if (current === stop) {
    current = null;
  }
}
