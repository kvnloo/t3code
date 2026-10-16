import { describe, expect, it } from "@effect/vitest";
import { createAssistantReadOnlyVoiceGate, type AssistantVoiceProjection } from "./voiceReadOnlyGate";

const projection: AssistantVoiceProjection = {
  environments: [
    { environmentId: "laptop", label: "Laptop", enabled: true, connected: true, shellLive: true },
  ],
  threads: [
    {
      environmentId: "laptop", threadId: "a", title: "Fix Android",
      updatedAt: "2026-10-16T10:00:00Z", needsApproval: true,
      needsAnswer: false, needsPlanReview: false, failed: false, working: false,
    },
  ],
};

const final = (utteranceId: string, transcript: string) => ({ utteranceId, transcript });

describe("read-only voice projection revocation", () => {
  it("does not return attention after explicit close during a projection read", () => {
    let gate!: ReturnType<typeof createAssistantReadOnlyVoiceGate>;
    gate = createAssistantReadOnlyVoiceGate({
      environmentId: "laptop",
      getProjection: () => {
        gate.close();
        return projection;
      },
    });
    expect(gate.admitFinal(final("u1", "show approvals"))).toEqual({
      kind: "refused", reason: "closed",
    });
    expect(gate.admitFinal(final("u2", "open thread Fix Android"))).toEqual({
      kind: "refused", reason: "closed",
    });
  });

  it("does not expose a thread target if the abort signal fires during projection", () => {
    const transport = new AbortController();
    const gate = createAssistantReadOnlyVoiceGate({
      environmentId: "laptop",
      signal: transport.signal,
      getProjection: () => {
        transport.abort();
        return projection;
      },
    });
    expect(gate.admitFinal(final("u1", "open thread Fix Android"))).toEqual({
      kind: "refused", reason: "closed",
    });
  });

  it("keeps normal projection reads functioning when not revoked", () => {
    const gate = createAssistantReadOnlyVoiceGate({
      environmentId: "laptop", getProjection: () => projection,
    });
    const attention = gate.admitFinal(final("u1", "show approvals"));
    expect(attention.kind).toEqual("attention");
    if (attention.kind !== "attention") throw new Error("Expected attention");
    expect(attention.total).toEqual(1);
    const chosen = gate.admitFinal(final("u2", "open thread Fix Android"));
    expect(chosen.kind).toEqual("open-thread");
    if (chosen.kind !== "open-thread") throw new Error("Expected thread");
    expect(chosen.thread.threadId).toEqual("a");
  });
});
