import { describe, expect, it } from "@effect/vitest";

import {
  createAssistantReadOnlyVoiceGate,
  type AssistantVoiceProjection,
} from "./voiceReadOnlyGate";

const laptop = {
  environmentId: "laptop",
  label: "Laptop",
  enabled: true,
  connected: true,
  shellLive: true,
} as const;
const phone = { ...laptop, environmentId: "phone", label: "Phone" } as const;

function thread(
  environmentId: string,
  threadId: string,
  title: string,
  kind: "approval" | "question" | "plan" | "failed" | "working",
) {
  return {
    environmentId,
    threadId,
    title,
    updatedAt: "2026-10-14T16:00:00Z",
    needsApproval: kind === "approval",
    needsAnswer: kind === "question",
    needsPlanReview: kind === "plan",
    failed: kind === "failed",
    working: kind === "working",
  };
}

function fixture(): AssistantVoiceProjection {
  return {
    environments: [laptop, phone],
    threads: [
      thread("laptop", "a", "Fix Android", "approval"),
      thread("laptop", "b", "Review PR", "question"),
      thread("laptop", "c", "Fix failure", "failed"),
      thread("laptop", "d", "Working on T3", "working"),
      thread("phone", "e", "Secret phone task", "approval"),
      thread("phone", "f", "Fix Android", "approval"),
    ],
  };
}

const utterance = (utteranceId: string, transcript: string) => ({ utteranceId, transcript });

describe("read-only Android voice admission", () => {
  it("returns only scoped live approvals, not questions, failures or other environments", () => {
    const gate = createAssistantReadOnlyVoiceGate({
      environmentId: "laptop",
      getProjection: fixture,
    });
    const response = gate.admitFinal(utterance("u1", "show approvals"));
    expect(response).toMatchObject({ kind: "attention", filter: "approvals", total: 1 });
    if (response.kind !== "attention") throw new Error("Expected attention response");
    expect(response.items.map((item) => item.threadId)).toEqual(["a"]);
    expect(JSON.stringify(response)).not.toContain("Secret phone task");
    expect(gate.admitFinal(utterance("u2", "what's waiting on me"))).toMatchObject({
      kind: "attention",
      filter: "needs-me",
      total: 3,
    });
    expect(gate.admitFinal(utterance("u3", "what's running"))).toMatchObject({
      kind: "attention",
      filter: "working",
      total: 1,
    });
  });

  it("resolves exact visible thread titles in the selected environment only", () => {
    const gate = createAssistantReadOnlyVoiceGate({ environmentId: "laptop", getProjection: fixture });
    expect(gate.admitFinal(utterance("u1", "open thread fix android"))).toEqual({
      kind: "open-thread",
      thread: { environmentId: "laptop", threadId: "a", title: "Fix Android" },
    });
    expect(gate.admitFinal(utterance("u2", "open thread Secret phone task"))).toEqual({
      kind: "refused",
      reason: "missing-thread",
    });
  });

  it("never chooses between two same-named threads", () => {
    const projection = fixture();
    const gate = createAssistantReadOnlyVoiceGate({
      environmentId: "laptop",
      getProjection: () => ({
        ...projection,
        threads: [...projection.threads, thread("laptop", "dupe", "Fix Android", "working")],
      }),
    });
    expect(gate.admitFinal(utterance("u1", "open thread Fix Android"))).toEqual({
      kind: "ambiguous",
      matches: 2,
    });
  });

  it("rechecks a live selected environment on every inspection or thread action", () => {
    let online = true;
    const gate = createAssistantReadOnlyVoiceGate({
      environmentId: "laptop",
      getProjection: () => ({
        ...fixture(),
        environments: [{ ...laptop, connected: online }, phone],
      }),
    });
    expect(gate.admitFinal(utterance("u1", "show approvals"))).toMatchObject({
      kind: "attention",
      total: 1,
    });
    online = false;
    expect(gate.admitFinal(utterance("u2", "show approvals"))).toEqual({
      kind: "refused",
      reason: "unavailable",
    });
    expect(gate.admitFinal(utterance("u3", "open thread Fix Android"))).toEqual({
      kind: "refused",
      reason: "unavailable",
    });
    // Local navigation never requires a network connection.
    expect(gate.admitFinal(utterance("u4", "open environments"))).toEqual({
      kind: "navigate",
      destination: "environments",
    });
  });

  it("does not grant write, approval or interruption authority to speech", () => {
    const gate = createAssistantReadOnlyVoiceGate({ environmentId: "laptop", getProjection: fixture });
    for (const [id, phrase] of [
      ["1", "approve everything"],
      ["2", "stop all agents"],
      ["3", "send a patch"],
      ["4", "archive thread Fix Android"],
      ["5", "what is my password?"],
    ]) {
      expect(gate.admitFinal(utterance(id, phrase))).toEqual({
        kind: "refused",
        reason: "unsupported",
      });
    }
  });

  it("rejects replayed final transcript ids even when content differs", () => {
    const gate = createAssistantReadOnlyVoiceGate({ environmentId: "laptop", getProjection: fixture });
    expect(gate.admitFinal(utterance("final-1", "show PRs"))).toEqual({
      kind: "navigate",
      destination: "pulls",
    });
    expect(gate.admitFinal(utterance("final-1", "show approvals"))).toEqual({
      kind: "refused",
      reason: "duplicate",
    });
  });

  it("fails closed for malformed ids, a too-long utterance, and dead transport", () => {
    const controller = new AbortController();
    const gate = createAssistantReadOnlyVoiceGate({
      environmentId: "laptop",
      getProjection: fixture,
      signal: controller.signal,
    });
    expect(gate.admitFinal(utterance("bad id", "show PRs"))).toEqual({
      kind: "refused",
      reason: "invalid-id",
    });
    expect(gate.admitFinal(utterance("ok", "x".repeat(161)))).toEqual({
      kind: "refused",
      reason: "unsupported",
    });
    expect(gate.admitFinal({ utteranceId: "malformed-transcript", transcript: null })).toEqual({
      kind: "refused",
      reason: "unsupported",
    });
    controller.abort();
    expect(gate.admitFinal(utterance("later", "show PRs"))).toEqual({
      kind: "refused",
      reason: "closed",
    });
  });

  it("does not evict old final IDs and stops before a session can grow without bound", () => {
    const gate = createAssistantReadOnlyVoiceGate({ environmentId: "laptop", getProjection: fixture });
    for (let index = 0; index < 256; index++) {
      expect(gate.admitFinal(utterance("u" + index, "show PRs"))).toEqual({
        kind: "navigate",
        destination: "pulls",
      });
    }
    expect(gate.admitFinal(utterance("u256", "show PRs"))).toEqual({
      kind: "refused",
      reason: "session-limit",
    });
    expect(gate.admitFinal(utterance("u0", "show PRs"))).toEqual({
      kind: "refused",
      reason: "duplicate",
    });
  });

  it("closes permanently and suppresses projection errors without leaking data", () => {
    const gate = createAssistantReadOnlyVoiceGate({
      environmentId: "laptop",
      getProjection: () => { throw new Error("private details must not surface"); },
    });
    expect(gate.admitFinal(utterance("u1", "show approvals"))).toEqual({
      kind: "refused",
      reason: "unavailable",
    });
    gate.close();
    expect(gate.admitFinal(utterance("u2", "show PRs"))).toEqual({
      kind: "refused",
      reason: "closed",
    });
  });

  it("caps the number of private attention items returned to the voice layer", () => {
    const gate = createAssistantReadOnlyVoiceGate({
      environmentId: "laptop",
      getProjection: () => ({
        environments: [laptop],
        threads: Array.from({ length: 14 }, (_, index) =>
          thread("laptop", String(index), "Approval " + index, "approval"),
        ),
      }),
    });
    const response = gate.admitFinal(utterance("u1", "show approvals"));
    expect(response).toMatchObject({ kind: "attention", total: 14 });
    if (response.kind !== "attention") throw new Error("Expected attention response");
    expect(response.items).toHaveLength(8);
    expect(response.items.every((item) => item.title.length <= 120)).toEqual(true);
  });
});
