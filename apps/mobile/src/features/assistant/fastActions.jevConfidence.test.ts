import { describe, expect, it } from "@effect/vitest";
import { admitAssistantJevNavigation } from "./fastActions";

describe("assistant Jev confidence admission", () => {
  it("refuses scores above the normalized probability range", () => {
    expect(admitAssistantJevNavigation("navigate to my chats", "chats", 1.01)).toEqual({
      kind: "agent", reason: "low-confidence",
    });
    expect(admitAssistantJevNavigation("navigate to my chats", "chats", 82)).toEqual({
      kind: "agent", reason: "low-confidence",
    });
  });

  it("admits valid normalized scores at the floor and ceiling", () => {
    for (const confidence of [0.82, 1]) {
      expect(admitAssistantJevNavigation("navigate to my chats", "chats", confidence)).toEqual({
        kind: "action", source: "jev", action: { kind: "navigate", destination: "chats" },
      });
    }
  });

  it("rejects nonfinite, negative and below-floor scores", () => {
    for (const confidence of [Number.NaN, Infinity, -Infinity, -1, 0, 0.819]) {
      expect(admitAssistantJevNavigation("navigate to my chats", "chats", confidence)).toEqual({
        kind: "agent", reason: "low-confidence",
      });
    }
  });

  it("never promotes non-navigation intents or unknown destinations", () => {
    expect(admitAssistantJevNavigation("approve the request", "chats", 0.99)).toEqual({
      kind: "agent", reason: "low-confidence",
    });
    expect(admitAssistantJevNavigation("navigate to my chats", "shell", 0.99)).toEqual({
      kind: "agent", reason: "low-confidence",
    });
  });
});
