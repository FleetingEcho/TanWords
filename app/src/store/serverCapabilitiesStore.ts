import { create } from "zustand";
import { isDesktopHost } from "@/platform";

interface ServerCapabilitiesState {
  /** Whether the web deployment currently authenticated against was built
   *  with the local sherpa-onnx TTS/ASR engines. Unlike `hostCapabilities`
   *  (a static, build-time constant of the frontend bundle itself), this is
   *  a runtime fact about *this particular server* — populated from
   *  `auth.bootstrap()`'s response once the web session resolves. Desktop
   *  never touches this store; it keeps gating on the static `nativeAsr`. */
  voiceAssistant: boolean;
  setVoiceAssistant: (value: boolean) => void;
}

export const useServerCapabilitiesStore = create<ServerCapabilitiesState>((set) => ({
  voiceAssistant: false,
  setVoiceAssistant: (value) => set({ voiceAssistant: value }),
}));

/** Effective voice-assistant availability for the current host: desktop's
 *  static `nativeAsr` capability, or (on web) whatever this deployment's
 *  bootstrap probe reported. */
export function useVoiceAssistantAvailable(): boolean {
  const webCapable = useServerCapabilitiesStore((s) => s.voiceAssistant);
  return isDesktopHost || webCapable;
}
