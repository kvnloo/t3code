import type { VoiceInputState } from "@t3tools/client-runtime/voice-input";

import type { VoiceRecordingSample } from "./voiceInputSession";

export type ContinuousVoiceState = {
  readonly phase: "idle" | "preparing" | "listening" | "hearing" | "transcribing" | "submitting" | "muted" | "error";
  readonly error: string | null;
};

export type ContinuousVoiceDependencies = {
  readonly startRecording: (commit: (text: string) => void) => Promise<void>;
  readonly finishRecording: () => Promise<void>;
  readonly cancelRecording: () => void;
  readonly recordingState: () => VoiceInputState;
  readonly sample: () => VoiceRecordingSample | null;
  readonly isCurrent: () => boolean;
  readonly submit: (text: string, signal: AbortSignal) => Promise<void>;
};

const IDLE: ContinuousVoiceState = { phase: "idle", error: null };
const SAMPLE_MS = 80;
const PAUSE_MS = 900;
const MIN_SPEECH_MS = 300;
const MAX_SEGMENT_MS = 30_000;

/** Serializes file-based utterances; cancellation invalidates every async boundary. */
export class ContinuousVoiceSession {
  private state: ContinuousVoiceState = IDLE;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private token: AbortController | null = null;
  private busy = false;
  private transcript = "";
  private speechMs = 0;
  private lastVoiceMs = 0;
  private lastSampleMs = 0;
  private missingSamples = 0;

  constructor(private readonly dependencies: ContinuousVoiceDependencies) {}

  get isActive(): boolean {
    return this.token !== null;
  }

  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async start(): Promise<void> {
    if (this.token || this.busy || !this.dependencies.isCurrent()) return;
    const token = new AbortController();
    this.token = token;
    await this.begin(token);
    if (this.current(token)) this.timer = setInterval(() => void this.sample(), SAMPLE_MS);
    else if (this.token === token) this.stop();
  }

  stop(muted = false): void {
    const wasActive = this.token !== null;
    this.token?.abort();
    this.token = null;
    clearInterval(this.timer);
    this.timer = undefined;
    this.transcript = "";
    if (wasActive) this.dependencies.cancelRecording();
    this.publish({ phase: muted ? "muted" : "idle", error: null });
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
  }

  async sample(): Promise<void> {
    try {
      await this.tick();
    } catch (error) {
      if (this.token) this.fail(error instanceof Error ? error.message : "Microphone capture failed.");
    }
  }

  private async tick(): Promise<void> {
    const token = this.token;
    if (!token) return;
    if (!this.current(token)) {
      this.stop();
      return;
    }
    if (this.busy) return;
    const state = this.dependencies.recordingState();
    if (state.phase === "error") {
      this.fail(state.error ?? "Voice recording stopped.");
      return;
    }
    if (state.phase === "transcribing") {
      this.publish({ phase: "transcribing", error: null });
      return;
    }
    // A native duration limit can finish the controller without a metering tick.
    if (state.phase === "idle") {
      await this.finish(token, false);
      return;
    }
    const sample = this.dependencies.sample();
    if (!sample) {
      if (state.phase === "recording" && ++this.missingSamples >= 12) this.fail("Microphone capture was interrupted.");
      return;
    }
    if (sample.metering === undefined || !Number.isFinite(sample.metering)) {
      if (++this.missingSamples >= 12) this.fail("Hands-free voice requires microphone metering on this device.");
      return;
    }
    this.missingSamples = 0;
    const elapsed = sample.durationMillis;
    const delta = Math.max(0, Math.min(elapsed - this.lastSampleMs, 200));
    this.lastSampleMs = elapsed;
    if (sample.metering > -40) {
      this.speechMs += delta;
      this.lastVoiceMs = elapsed;
      if (this.speechMs >= MIN_SPEECH_MS) this.publish({ phase: "hearing", error: null });
    }
    const paused = this.speechMs > 0 && elapsed - this.lastVoiceMs >= PAUSE_MS;
    if (paused || elapsed >= MAX_SEGMENT_MS) await this.finish(token, true);
  }

  private async begin(token: AbortController): Promise<void> {
    if (!this.current(token)) return;
    this.busy = true;
    this.transcript = "";
    this.speechMs = 0;
    this.lastVoiceMs = 0;
    this.lastSampleMs = 0;
    this.missingSamples = 0;
    this.publish({ phase: "preparing", error: null });
    try {
      await this.dependencies.startRecording((text) => {
        if (this.current(token)) this.transcript = text.trim();
      });
      if (!this.current(token)) return;
      const state = this.dependencies.recordingState();
      if (state.phase !== "recording") {
        this.fail(state.error ?? "Could not start hands-free recording.");
        return;
      }
      this.publish({ phase: "listening", error: null });
    } catch (error) {
      if (this.current(token)) this.fail(error instanceof Error ? error.message : "Could not start voice input.");
    } finally {
      this.busy = false;
    }
  }

  private async finish(token: AbortController, recording: boolean): Promise<void> {
    this.busy = true;
    try {
      if (recording) {
        if (this.speechMs < MIN_SPEECH_MS) {
          this.dependencies.cancelRecording();
        } else {
          this.publish({ phase: "transcribing", error: null });
          await this.dependencies.finishRecording();
        }
      }
      if (!this.current(token)) return;
      const state = this.dependencies.recordingState();
      if (state.phase === "error") {
        this.fail(state.error ?? "Could not transcribe voice input.");
        return;
      }
      const text = this.transcript;
      this.transcript = "";
      if (text && this.speechMs >= MIN_SPEECH_MS) {
        this.publish({ phase: "submitting", error: null });
        await this.dependencies.submit(text, token.signal);
      }
      if (this.current(token)) await this.begin(token);
      else if (this.token === token) this.stop();
    } catch (error) {
      if (this.current(token)) this.fail(error instanceof Error ? error.message : "Could not submit voice input.");
    } finally {
      this.busy = false;
      if (this.token === token && !this.current(token)) this.stop();
    }
  }

  private current(token: AbortController): boolean {
    return this.token === token && !token.signal.aborted && this.dependencies.isCurrent();
  }

  private fail(error: string): void {
    this.stop();
    this.publish({ phase: "error", error });
  }

  private publish(state: ContinuousVoiceState): void {
    if (this.state.phase === state.phase && this.state.error === state.error) return;
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
