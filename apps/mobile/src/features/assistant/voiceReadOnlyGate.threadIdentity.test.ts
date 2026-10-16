import { describe, expect, it } from "@effect/vitest";
import { createAssistantReadOnlyVoiceGate } from "./voiceReadOnlyGate";

const live = {
  environmentId: "laptop", label: "Laptop", enabled: true, connected: true, shellLive: true,
};
const approval = {
  environmentId: "laptop", threadId: "thread-1", title: "Fix Android",
  updatedAt: "2026-10-16T10:00:00Z", needsApproval: true, needsAnswer: false,
  needsPlanReview: false, failed: false, working: false,
};

function read(threads: ReadonlyArray<typeof approval>, utterance: string) {
  return createAssistantReadOnlyVoiceGate({
    environmentId: "laptop", getProjection: () => ({ environments: [live], threads }),
  }).admitFinal({ utteranceId: "final-1", transcript: utterance });
}

describe("voice gate thread-identity reconciliation", () => {
  it("refuses a stale title when the same thread ID has conflicting shell rows", () => {
    const renamed = { ...approval, title: "Other work" };
    for (const rows of [[approval, renamed], [renamed, approval]]) {
      expect(read(rows, "open thread Fix Android")).toEqual({
        kind: "refused", reason: "unavailable",
      });
    }
  });

  it("never reports zero approvals when a same-ID shell disagrees about approval state", () => {
    const stale = { ...approval, needsApproval: false };
    for (const rows of [[stale, approval], [approval, stale]]) {
      expect(read(rows, "show approvals")).toEqual({
        kind: "refused", reason: "unavailable",
      });
    }
  });

  it("deduplicates identical rows without changing their single logical identity", () => {
    expect(read([approval, { ...approval }], "open thread Fix Android")).toEqual({
      kind: "open-thread", thread: {
        environmentId: "laptop", threadId: "thread-1", title: "Fix Android",
      },
    });
    const attention = read([approval, { ...approval }], "show approvals");
    expect(attention.kind).toEqual("attention");
    if (attention.kind !== "attention") throw new Error("expected attention");
    expect(attention.total).toEqual(1);
    expect(attention.items.length).toEqual(1);
  });

  it("keeps independent thread identities available", () => {
    const another = { ...approval, threadId: "thread-2", title: "Fix Voice" };
    expect(read([approval, another], "open thread Fix Voice")).toEqual({
      kind: "open-thread", thread: {
        environmentId: "laptop", threadId: "thread-2", title: "Fix Voice",
      },
    });
  });
});
