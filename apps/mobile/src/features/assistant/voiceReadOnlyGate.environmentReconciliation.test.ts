import { describe, expect, it } from "@effect/vitest";
import { createAssistantReadOnlyVoiceGate } from "./voiceReadOnlyGate";

const live = {
  environmentId: "laptop",
  label: "Laptop",
  enabled: true,
  connected: true,
  shellLive: true,
};
const approval = {
  environmentId: "laptop",
  threadId: "a",
  title: "Fix Android",
  updatedAt: "2026-10-16T10:00:00Z",
  needsApproval: true,
  needsAnswer: false,
  needsPlanReview: false,
  failed: false,
  working: false,
};

function read(environments: ReadonlyArray<typeof live>, transcript: string) {
  const gate = createAssistantReadOnlyVoiceGate({
    environmentId: "laptop",
    getProjection: () => ({ environments, threads: [approval] }),
  });
  return gate.admitFinal({ utteranceId: "final-1", transcript });
}

describe("voice gate selected-environment identity reconciliation", () => {
  it("fails closed if any same-ID registry row is offline, regardless of input order", () => {
    const offline = { ...live, connected: false };
    for (const environments of [[live, offline], [offline, live]]) {
      expect(read(environments, "show approvals")).toEqual({
        kind: "refused", reason: "unavailable",
      });
      expect(read(environments, "open thread Fix Android")).toEqual({
        kind: "refused", reason: "unavailable",
      });
    }
  });

  it("fails closed if one identity is concurrently labeled as a different environment", () => {
    for (const environments of [
      [live, { ...live, label: "Phone" }],
      [{ ...live, label: "Phone" }, live],
    ]) {
      expect(read(environments, "show approvals")).toEqual({
        kind: "refused", reason: "unavailable",
      });
    }
  });

  it("preserves read-only behavior when duplicate registry rows agree", () => {
    const response = read([live, { ...live }], "show approvals");
    expect(response.kind).toEqual("attention");
    if (response.kind !== "attention") throw new Error("Expected attention");
    expect(response.filter).toEqual("approvals");
    expect(response.total).toEqual(1);
  });
});
