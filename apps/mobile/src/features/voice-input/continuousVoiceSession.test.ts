import { describe, expect, it, vi } from "vite-plus/test";
import type { VoiceInputState } from "@t3tools/client-runtime/voice-input";
import { ContinuousVoiceSession, type ContinuousVoiceDependencies } from "./continuousVoiceSession";
import { VoiceInputSession } from "./voiceInputSession";

function fakeTimers() {
  vi.useFakeTimers();
  return { [Symbol.dispose]: () => vi.useRealTimers() };
}

function setup() {
  let state: VoiceInputState = { phase: "idle", error: null, errorAction: null };
  let durationMillis = 0;
  let metering: number | undefined = -60;
  let current = true;
  let commit: (text: string) => void = () => {};
  const dependencies = {
    startRecording: vi.fn(async (onCommit) => {
      commit = onCommit;
      durationMillis = 0;
      state = { phase: "recording", error: null, errorAction: null };
    }),
    finishRecording: vi.fn(async () => {
      state = { phase: "transcribing", error: null, errorAction: null };
      commit("one utterance");
      state = { phase: "idle", error: null, errorAction: null };
    }),
    cancelRecording: vi.fn(() => { state = { phase: "idle", error: null, errorAction: null }; }),
    recordingState: () => state,
    sample: () => ({ durationMillis, metering }),
    isCurrent: () => current,
    submit: vi.fn<ContinuousVoiceDependencies["submit"]>(async () => {}),
  } satisfies ContinuousVoiceDependencies;
  const session = new ContinuousVoiceSession(dependencies);
  const sample = async (duration: number, db = -20) => {
    durationMillis = duration;
    metering = db;
    await session.sample();
  };
  const speech = async () => {
    await sample(100);
    await sample(200);
    await sample(300);
  };
  return { session, dependencies, sample, speech, setCurrent: (value: boolean) => { current = value; }, setState: (value: VoiceInputState) => { state = value; }, setMetering: () => { metering = undefined; } };
}

describe("continuous voice lifecycle", () => {
  it("reuses the shared controller and releases each file before the next utterance", async () => {
    using _timers = fakeTimers();
    let durationMillis = 0;
    let metering = -20;
    const events: string[] = [];
    const submit = vi.fn(async (_text: string, _signal: AbortSignal) => {});
    const session = new VoiceInputSession({
      recorder: {
        uri: "file:///hands-free.m4a",
        prepareToRecordAsync: async () => { events.push("prepare"); },
        record: () => {},
        stop: async () => {},
      },
      getTranscriber: () => ({
        prepare: async () => ({
          locale: "en-US",
          transcribe: async () => "voice only",
        }),
      }),
      requestPermission: async () => ({ granted: true, canAskAgain: true }),
      configureRecording: async () => {},
      releaseRecording: async () => {},
      deleteRecording: () => { events.push("delete"); },
      sampleRecording: () => ({ durationMillis, metering }),
      publishAudioLevels: () => {},
      keepAwake: () => () => {},
    });
    const continuous = new ContinuousVoiceSession({
      isCurrent: () => true,
      recordingState: () => session.controller.currentState,
      sample: () => session.sample(),
      startRecording: (commit) => {
        durationMillis = 0;
        return session.start({
          ownerKey: "environment-a/thread-a",
          readDraft: () => ({ ownerKey: "environment-a/thread-a", text: "", selection: { start: 0, end: 0 }, revision: 0 }),
          commitDraft: (text) => commit(text),
          subscribe: () => () => {},
        }, true);
      },
      finishRecording: () => session.controller.stop(),
      cancelRecording: () => session.controller.cancel(),
      submit,
    });
    session.continuous = continuous;
    try {
      await continuous.start();
      for (const utterance of ["first", "second"]) {
        for (const duration of [100, 200, 300]) {
          durationMillis = duration;
          metering = -20;
          await continuous.sample();
        }
        durationMillis = 1200;
        metering = -60;
        await continuous.sample();
        expect(continuous.getSnapshot().phase, utterance).toBe("listening");
      }
      expect(submit.mock.calls.map(([text]) => text)).toEqual(["voice only", "voice only"]);
      expect(events).toEqual(["prepare", "delete", "prepare", "delete", "prepare"]);
    } finally {
      continuous.stop();
      session.dispose();
    }
  });
  it("submits a final utterance once and resumes, ignoring overlapping ticks", async () => {
    using _timers = fakeTimers();
    const { session, dependencies, sample, speech } = setup();
    const pending = Promise.withResolvers<void>();
    const submit = vi.fn(() => pending.promise);
    dependencies.submit.mockImplementation(submit);
    await session.start();
    await speech();
    expect(session.getSnapshot().phase).toBe("hearing");
    const finished = sample(1200, -60);
    await session.sample();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().phase).toBe("submitting");
    pending.resolve();
    await finished;
    expect(session.getSnapshot().phase).toBe("listening");
    expect(dependencies.startRecording).toHaveBeenCalledTimes(2);
    await speech();
    await sample(1200, -60);
    expect(submit).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it.each(["stop", "mute", "navigation", "background", "disconnect"])("drops transcription completing after %s", async (reason) => {
    using _timers = fakeTimers();
    const { session, dependencies, speech, sample, setCurrent } = setup();
    const transcription = Promise.withResolvers<void>();
    const finish = dependencies.finishRecording.getMockImplementation();
    dependencies.finishRecording.mockImplementation(async () => { await transcription.promise; await finish?.(); });
    await session.start();
    await speech();
    const finishing = sample(1200, -60);
    if (reason === "navigation" || reason === "disconnect") setCurrent(false);
    else session.stop(reason === "mute");
    transcription.resolve();
    await finishing;
    expect(dependencies.submit).not.toHaveBeenCalled();
    expect(dependencies.startRecording).toHaveBeenCalledTimes(1);
    session.dispose();
  });

  it("invalidates a permission/preparation result when stopped", async () => {
    using _timers = fakeTimers();
    const { session, dependencies } = setup();
    const preparation = Promise.withResolvers<void>();
    dependencies.startRecording.mockImplementation(() => preparation.promise);
    const starting = session.start();
    session.stop();
    preparation.resolve();
    await starting;
    expect(session.getSnapshot().phase).toBe("idle");
    expect(vi.getTimerCount()).toBe(0);
    expect(dependencies.submit).not.toHaveBeenCalled();
    session.dispose();
  });

  it("rotates silent recordings without transcription and rejects brief noise", async () => {
    using _timers = fakeTimers();
    const { session, dependencies, sample } = setup();
    await session.start();
    await sample(30_000, -60);
    await sample(100);
    await sample(1000, -60);
    expect(dependencies.finishRecording).not.toHaveBeenCalled();
    expect(dependencies.submit).not.toHaveBeenCalled();
    expect(dependencies.startRecording).toHaveBeenCalledTimes(3);
    session.dispose();
  });

  it.each(["metering", "permission", "submission"])("fails closed on %s failure", async (failure) => {
    using _timers = fakeTimers();
    const { session, dependencies, sample, speech, setMetering, setState } = setup();
    await session.start();
    if (failure === "metering") {
      setMetering();
      await vi.advanceTimersByTimeAsync(1000);
    } else if (failure === "permission") {
      setState({ phase: "error", error: "Microphone access lost", errorAction: "settings" });
      await session.sample();
    } else {
      dependencies.submit.mockRejectedValue(new Error("Outbox unavailable"));
      await speech();
      await sample(1200, -60);
    }
    expect(session.getSnapshot().phase).toBe("error");
    expect(session.isActive).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(dependencies.startRecording).toHaveBeenCalledTimes(1);
    session.dispose();
  });

  it("aborts delivery on stop and never retries an uncertain submission", async () => {
    using _timers = fakeTimers();
    const { session, dependencies, sample, speech } = setup();
    const delivery = Promise.withResolvers<void>();
    const submitted = Promise.withResolvers<void>();
    let signal: AbortSignal | undefined;
    dependencies.submit.mockImplementation((_text, currentSignal) => {
      signal = currentSignal;
      submitted.resolve();
      return delivery.promise;
    });
    await session.start();
    await speech();
    const finishing = sample(1200, -60);
    await submitted.promise;
    session.stop();
    expect(signal?.aborted).toBe(true);
    delivery.resolve();
    await finishing;
    expect(dependencies.submit).toHaveBeenCalledTimes(1);
    expect(dependencies.startRecording).toHaveBeenCalledTimes(1);
    session.dispose();
  });
});
