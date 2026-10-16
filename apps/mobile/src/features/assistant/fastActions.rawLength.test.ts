import { describe, expect, it } from "@effect/vitest";
import { admitAssistantJevNavigation, resolveAssistantFastAction } from "./fastActions";

describe("bounded assistant command input before NFKC normalization", () => {
  it("rejects a padded final transcript over 160 raw code units", () => {
    expect(resolveAssistantFastAction(" ".repeat(161) + "show approvals")).toEqual({
      kind: "agent",
      reason: "too-long",
    });
  });

  it("rejects a padded Jev navigation input instead of bypassing the limit", () => {
    expect(admitAssistantJevNavigation(" ".repeat(161) + "open usage", "usage", 1)).toEqual({
      kind: "agent",
      reason: "too-long",
    });
  });

  it("preserves exactly 160 raw code units and ordinary commands", () => {
    const input = " ".repeat(150) + "open usage"; // 160 raw units
    expect(input.length).toEqual(160);
    expect(resolveAssistantFastAction(input)).toEqual({
      kind: "action",
      source: "rule",
      action: { kind: "navigate", destination: "usage" },
    });
    expect(resolveAssistantFastAction("show approvals")).toEqual({
      kind: "action",
      source: "rule",
      action: { kind: "inspect", queue: "approvals" },
    });
  });

  it("still bounds expansion caused by Unicode normalization", () => {
    expect(resolveAssistantFastAction("\uFB03".repeat(54))).toEqual({
      kind: "agent",
      reason: "too-long",
    });
  });
});
