import { describe, expect, it } from "@effect/vitest";

import {
  buildAssistantAttentionSnapshot,
  filterAssistantAttentionItems,
  type AssistantAttentionEnvironment,
  type AssistantAttentionFacts,
} from "./attentionSnapshot";

const live: AssistantAttentionEnvironment = {
  environmentId: "laptop",
  label: "Laptop",
  enabled: true,
  connected: true,
  shellLive: true,
};

function thread(
  overrides: Partial<AssistantAttentionFacts> & Pick<AssistantAttentionFacts, "threadId">,
): AssistantAttentionFacts {
  return {
    environmentId: "laptop",
    title: overrides.threadId,
    updatedAt: "2026-10-14T19:00:00Z",
    needsApproval: false,
    needsAnswer: false,
    needsPlanReview: false,
    failed: false,
    working: false,
    ...overrides,
  };
}

describe("assistant attention snapshot", () => {
  it("keeps approvals exact while needs-me also includes questions, plans and failures", () => {
    const snapshot = buildAssistantAttentionSnapshot(
      [live],
      [
        thread({ threadId: "approval", needsApproval: true }),
        thread({ threadId: "question", needsAnswer: true }),
        thread({ threadId: "plan", needsPlanReview: true }),
        thread({ threadId: "failure", failed: true }),
        thread({ threadId: "working", working: true }),
      ],
    );
    const ids = (filter: "approvals" | "needs-me" | "working" | "all") =>
      filterAssistantAttentionItems(snapshot.items, filter).map((item) => item.threadId);

    expect(ids("approvals")).toEqual(["approval"]);
    expect(ids("needs-me")).toEqual(["approval", "question", "plan", "failure"]);
    expect(ids("working")).toEqual(["working"]);
    expect(ids("all")).toEqual(["approval", "question", "plan", "failure", "working"]);
  });

  it("ranks human decisions above failures and working; chooses one state per thread", () => {
    const snapshot = buildAssistantAttentionSnapshot(
      [live],
      [
        thread({ threadId: "working", working: true }),
        thread({ threadId: "failed", failed: true }),
        thread({ threadId: "plan", needsPlanReview: true }),
        thread({ threadId: "answer", needsAnswer: true, working: true }),
        thread({ threadId: "approval", needsApproval: true, failed: true, working: true }),
        thread({ threadId: "quiet" }),
      ],
    );
    expect(snapshot.items.map((item) => [item.threadId, item.kind])).toEqual([
      ["approval", "approval"],
      ["answer", "question"],
      ["plan", "plan"],
      ["failed", "failed"],
      ["working", "working"],
    ]);
    expect(snapshot.counts).toEqual({
      approval: 1,
      question: 1,
      plan: 1,
      failed: 1,
      working: 1,
    });
  });

  it("does not claim cached, disabled, reconnecting, or unsynchronized environments are live", () => {
    const snapshot = buildAssistantAttentionSnapshot(
      [
        live,
        { ...live, environmentId: "disabled", label: "Disabled", enabled: false },
        { ...live, environmentId: "offline", label: "Offline", connected: false },
        { ...live, environmentId: "cached", label: "Cached", shellLive: false },
      ],
      [
        thread({ threadId: "live", needsApproval: true }),
        thread({ threadId: "off", environmentId: "disabled", needsApproval: true }),
        thread({ threadId: "disconnected", environmentId: "offline", working: true }),
        thread({ threadId: "syncing", environmentId: "cached", needsAnswer: true }),
      ],
    );
    expect(snapshot.items.map((item) => item.threadId)).toEqual(["live"]);
    expect(snapshot.liveEnvironmentCount).toBe(1);
    expect(snapshot.unavailableEnvironments).toEqual(["Disabled", "Offline", "Cached"]);
  });

  it("keeps same-named threads in separate environments, but deduplicates the same ref", () => {
    const snapshot = buildAssistantAttentionSnapshot(
      [live, { ...live, environmentId: "phone", label: "Phone" }],
      [
        thread({ threadId: "a", title: "Fix T3", needsApproval: true }),
        thread({ threadId: "a", title: "Fix T3", needsApproval: true }),
        thread({ threadId: "a", environmentId: "phone", title: "Fix T3", needsAnswer: true }),
      ],
    );
    expect(snapshot.items.map((item) => [item.environmentId, item.threadId])).toEqual([
      ["laptop", "a"],
      ["phone", "a"],
    ]);
  });

  it("does not show a stale failed run as a failure during new active work", () => {
    const snapshot = buildAssistantAttentionSnapshot(
      [live],
      [thread({ threadId: "retry", failed: true, working: true })],
    );
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]?.kind).toBe("working");
  });

  it("orders equally urgent items newest first with stable fallback", () => {
    const snapshot = buildAssistantAttentionSnapshot(
      [live],
      [
        thread({ threadId: "older", needsApproval: true, updatedAt: "2026-10-13T10:00:00Z" }),
        thread({ threadId: "newer", needsApproval: true, updatedAt: "2026-10-14T10:00:00Z" }),
        thread({ threadId: "bad", needsApproval: true, updatedAt: "invalid" }),
      ],
    );
    expect(snapshot.items.map((item) => item.threadId)).toEqual(["newer", "older", "bad"]);
  });
});
