/** Push-to-talk mic capture for the voice assistant.
 *
 * Deliberately Web Audio + AudioWorklet, not `MediaRecorder`: the ASR path
 * needs raw PCM (see `asr::engine::wav_to_pcm` on the Rust side, which only
 * understands the exact WAV shape this file writes), and per the deleted
 * Speaking-Partner feature's own notes, `MediaRecorder`'s compressed output
 * (webm/mp4) is an unnecessary decode step for zero benefit here.
 *
 * No manual resampling: sherpa-onnx's `OfflineRecognizer` resamples internally
 * from whatever rate `OfflineStream::accept_waveform` is given, so this
 * records at the AudioContext's native rate (commonly 48000Hz) and writes
 * that rate straight into the WAV header.
 */

// A tiny worklet processor, registered from a Blob URL so it needs no
// separate build-time asset handling. It only ever forwards raw render
// quantums (128 samples) to the main thread — no processing happens on the
// audio thread beyond that.
const WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      this.port.postMessage(input[0].slice());
    }
    return true;
  }
}
registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
`;

export class MicPermissionError extends Error {}

export class PcmRecorder {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private silentSink: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private observedPeak = 0;

  onLevel: ((peak: number) => void) | null = null;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });

    // Everything after getUserMedia must tear the stream back down on
    // failure — otherwise a rejected addModule leaves the mic hot (the OS
    // indicator stays on) with a resident AudioContext until app quit.
    try {
      this.context = new AudioContext();
      const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
      try {
        await this.context.audioWorklet.addModule(workletUrl);
      } finally {
        URL.revokeObjectURL(workletUrl);
      }

      this.source = this.context.createMediaStreamSource(this.stream);
      this.worklet = new AudioWorkletNode(this.context, "pcm-capture-processor");
      this.chunks = [];
      this.observedPeak = 0;

      this.worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const chunk = event.data;
        this.chunks.push(chunk);
        let peak = 0;
        for (let i = 0; i < chunk.length; i++) peak = Math.max(peak, Math.abs(chunk[i]));
        this.observedPeak = Math.max(this.observedPeak, peak);
        this.onLevel?.(peak);
      };

      // A worklet node with no path to `destination` is not guaranteed to be
      // pulled by the graph in every browser — route through a silent (gain 0)
      // sink instead of leaving it dangling.
      this.silentSink = this.context.createGain();
      this.silentSink.gain.value = 0;
      this.source.connect(this.worklet);
      this.worklet.connect(this.silentSink);
      this.silentSink.connect(this.context.destination);
    } catch (err) {
      this.teardown();
      this.chunks = [];
      throw err;
    }
  }

  /** Stops capture and returns the recording as a base64-encoded mono
   *  16-bit-PCM WAV. Throws `MicPermissionError` if the whole clip was
   *  silent — `getUserMedia` grants a silent stream rather than throwing
   *  when the OS denies microphone access, so peak level is the only signal. */
  async stop(): Promise<string> {
    const sampleRate = this.context?.sampleRate ?? 48000;
    this.teardown();

    if (this.observedPeak < 0.001) {
      throw new MicPermissionError("no audio captured — check microphone permission");
    }

    const totalLength = this.chunks.reduce((sum, c) => sum + c.length, 0);
    const samples = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];

    return floatToWavBase64(samples, sampleRate);
  }

  cancel(): void {
    this.teardown();
    this.chunks = [];
  }

  private teardown(): void {
    this.worklet?.port.close();
    this.worklet?.disconnect();
    this.source?.disconnect();
    this.silentSink?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.context?.close();
    this.worklet = null;
    this.source = null;
    this.silentSink = null;
    this.stream = null;
    this.context = null;
  }
}

function floatToWavBase64(samples: Float32Array, sampleRate: number): string {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const dataSize = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  new Int16Array(buffer, 44).set(pcm);

  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
