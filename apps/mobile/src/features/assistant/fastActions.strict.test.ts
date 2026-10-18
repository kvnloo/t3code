import { describe, expect, it } from "@effect/vitest";

import { admitAssistantJevNavigation, resolveAssistantFastAction } from "./fastActions";

describe("assistant Jev complete-intent navigation admission", () => {
  it.each([
    "Bring up the PR dashboard and merge approved branches",
    "Open the usage page; approve everything",
    "Navigate to chats, then stop the running agent",
    "Open pulls approve all",
    "Jump to environments and disconnect all servers",
    "Bring up the PR dashboard deploy the latest build",
    "Show chats archive the oldest thread",
    "Open usage change my billing plan",
    "Navigate to PRs push the release",
    "Jump to environments create an API key",
    "Open pulls close the review",
    "Show chats pin this conversation",
    "Bring up the PR dashboard publish this release",
    "Show chats upload my logs",
    "Open the usage overview notify the team",
    "Navigate to environments screenshot the credentials",
    "Open the PR dashboard to merge the branch",
    "Jump to usage overview; share the billing data",
  ])("does not drop a trailing instruction: %s", (utterance) => {
    expect(admitAssistantJevNavigation(utterance, "pulls", 0.99)).toEqual({
      kind: "agent",
      reason: "low-confidence",
    });
  });

  it.each([
    ["Bring up the PR dashboard", "pulls"],
    ["Jump to the usage overview", "usage"],
    ["Navigate to my environments", "environments"],
    ["Switch to the chats page", "chats"],
  ] as const)("keeps a simple matching navigation: %s", (utterance, destination) => {
    expect(admitAssistantJevNavigation(utterance, destination, 0.95)).toEqual({
      kind: "action",
      source: "jev",
      action: { kind: "navigate", destination },
    });
  });

  it("rejects a high-confidence destination inconsistent with the request", () => {
    expect(admitAssistantJevNavigation("Bring up the PR dashboard", "chats", 0.99)).toEqual({
      kind: "agent",
      reason: "low-confidence",
    });
  });

  it("preserves exact safe local commands", () => {
    expect(resolveAssistantFastAction("Open usage")).toEqual({
      kind: "action",
      source: "rule",
      action: { kind: "navigate", destination: "usage" },
    });
    expect(resolveAssistantFastAction("Show approvals")).toEqual({
      kind: "action",
      source: "rule",
      action: { kind: "inspect", queue: "approvals" },
    });
  });
});
