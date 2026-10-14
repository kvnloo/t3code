import { describe, expect, it } from "@effect/vitest";

import {
  admitAssistantJevNavigation,
  findUniqueVisibleAssistantThread,
  findVisibleAssistantThreadMatches,
  resolveAssistantFastAction,
} from "./fastActions";

describe("app assistant fast actions", () => {
  it("routes exact local navigation without touching threads", () => {
    expect(resolveAssistantFastAction("Show my threads!")).toEqual({
      kind: "action",
      source: "rule",
      action: { kind: "navigate", destination: "chats" },
    });
    expect(resolveAssistantFastAction("Go to pull requests")).toEqual({
      kind: "action",
      source: "rule",
      action: { kind: "navigate", destination: "pulls" },
    });
    expect(resolveAssistantFastAction("Open usage limits")).toEqual({
      kind: "action",
      source: "rule",
      action: { kind: "navigate", destination: "usage" },
    });
  });

  it("keeps inspection read-only and sends complex requests to the agent", () => {
    expect(resolveAssistantFastAction("Show approvals")).toEqual({
      kind: "action",
      source: "rule",
      action: { kind: "inspect", queue: "approvals" },
    });
    expect(resolveAssistantFastAction("What's waiting on me?")).toEqual({
      kind: "action",
      source: "rule",
      action: { kind: "inspect", queue: "needs-me" },
    });
    expect(resolveAssistantFastAction("show working agents")).toEqual({
      kind: "action",
      source: "rule",
      action: { kind: "inspect", queue: "working" },
    });
    expect(resolveAssistantFastAction("Stop all agents")).toEqual({
      kind: "agent",
      reason: "unrecognized",
    });
    expect(resolveAssistantFastAction("Send the patch to every thread")).toEqual({
      kind: "agent",
      reason: "unrecognized",
    });
    expect(resolveAssistantFastAction("x".repeat(161))).toEqual({
      kind: "agent",
      reason: "too-long",
    });
  });

  it("limits Jev to allowlisted destinations and validates confidence", () => {
    expect(admitAssistantJevNavigation("bring up the PR dashboard", "pulls", 0.93)).toEqual({
      kind: "action",
      source: "jev",
      action: { kind: "navigate", destination: "pulls" },
    });
    for (const [destination, confidence] of [
      ["pulls", 0.81],
      ["delete_all", 0.99],
      ["pulls", Number.NaN],
    ] as const) {
      expect(admitAssistantJevNavigation("bring up the PR dashboard", destination, confidence)).toEqual({
        kind: "agent",
        reason: "low-confidence",
      });
    }
    expect(admitAssistantJevNavigation("stop all agents", "pulls", 0.99)).toEqual({
      kind: "agent",
      reason: "low-confidence",
    });
    expect(admitAssistantJevNavigation("approve everything", "chats", 0.99)).toEqual({
      kind: "agent",
      reason: "low-confidence",
    });
    expect(admitAssistantJevNavigation("Open usage", "pulls", 1)).toEqual({
      kind: "action",
      source: "rule",
      action: { kind: "navigate", destination: "usage" },
    });
  });

  it("requires a unique, visible thread match across environments", () => {
    const first = { environmentId: "laptop", threadId: "a", title: "Fix Android" };
    const second = { environmentId: "desktop", threadId: "b", title: "Fix Android" };
    expect(resolveAssistantFastAction("Open thread Fix Android")).toEqual({
      kind: "action",
      source: "rule",
      action: { kind: "find-thread", title: "fix android" },
    });
    expect(findUniqueVisibleAssistantThread("Fix Android", [first])).toEqual(first);
    expect(findVisibleAssistantThreadMatches("fix android", [first, second])).toEqual([
      first,
      second,
    ]);
    expect(findVisibleAssistantThreadMatches("unavailable", [first, second])).toEqual([]);
    expect(findUniqueVisibleAssistantThread("fix android", [first, second])).toBeNull();
    expect(findUniqueVisibleAssistantThread("unavailable", [first])).toBeNull();
  });
});
