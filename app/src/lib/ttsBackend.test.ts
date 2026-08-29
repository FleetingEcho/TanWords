/**
 * Remote-TTS branch of the speech path.
 *
 * `synthesizeBlob` routes to `tts_remote_synthesize` when a remote provider
 * is selected, and — deliberately unlike the local engine — its failures must
 * NOT fall back to webspeech: the user picked a specific remote voice, and a
 * silent substitution would read as "the voice changed", not as degraded
 * output. These tests pin both halves of that contract.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/ipc/backend", () => ({ invoke }));

import { synthesizeBlob, ensureTtsLoaded, WebSpeechFallbackRequired } from "./ttsBackend";
import { useSettingsStore } from "@/store/settingsStore";

const WAV_BASE64 = Buffer.from(
  // 44-byte RIFF-less stub: only the Blob type and byte length matter here.
  Uint8Array.from({ length: 64 }, (_, i) => i & 0xff),
).toString("base64");

function setRemote(providerId: string, voice = "speaker_a") {
  useSettingsStore.setState({ ttsRemoteProviderId: providerId, ttsRemoteVoice: voice });
}

describe("synthesizeBlob remote branch", () => {
  beforeEach(() => {
    invoke.mockReset();
    useSettingsStore.setState({ ttsRemoteProviderId: "", ttsRemoteVoice: "", ttsModelPath: "" });
  });

  it("calls tts_remote_synthesize when a remote provider is selected", async () => {
    invoke.mockResolvedValue(WAV_BASE64);
    setRemote("tts-abc");

    const blob = await synthesizeBlob("hello remote world");

    expect(invoke).toHaveBeenCalledWith(
      "tts_remote_synthesize",
      { text: "hello remote world", speed: 1.0 },
      undefined,
    );
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(64);
  });

  it("propagates remote errors instead of falling back to webspeech", async () => {
    invoke.mockRejectedValue(new Error("remote TTS returned 404: no such voice"));
    setRemote("tts-abc");

    await expect(synthesizeBlob("boom")).rejects.toThrow("404");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("uses the local engine when no remote provider is selected", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "tts_engine_status") return null;
      // Reality when no local model is loaded: the synthesize call fails
      // with the self-heal sentinel, the heal finds no persisted path, and
      // the fallback error surfaces.
      if (command === "tts_synthesize") throw new Error("model-not-loaded");
      throw new Error(`unexpected command ${command}`);
    });
    useSettingsStore.setState({ ttsModelPath: "" });

    // No local model and no remote: the documented behaviour is a
    // WebSpeechFallbackRequired, not a raw error.
    await expect(synthesizeBlob("local path")).rejects.toBeInstanceOf(WebSpeechFallbackRequired);
    expect(invoke).not.toHaveBeenCalledWith("tts_remote_synthesize", expect.anything(), expect.anything());
  });

  it("ensureTtsLoaded reports ready without touching local model files", async () => {
    invoke.mockImplementation(async (command: string) => {
      throw new Error(`unexpected command ${command}`);
    });
    setRemote("tts-abc");

    await expect(ensureTtsLoaded()).resolves.toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });
});
