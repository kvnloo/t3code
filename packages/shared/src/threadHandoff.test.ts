import { describe, expect, it } from "vite-plus/test";

import {
  handoffThreadTitle,
  parseHandoffCommand,
  pickedProviderCommandForDraft,
  resolveHandoffSend,
  threadHandoffDisabledReason,
} from "./threadHandoff.ts";

describe("parseHandoffCommand", () => {
  it("reads the focus after /handoff", () => {
    expect(parseHandoffCommand("/handoff")).toEqual({ focus: "" });
    expect(parseHandoffCommand("  /HANDOFF  fix the flaky test \n")).toEqual({
      focus: "fix the flaky test",
    });
    expect(parseHandoffCommand("/handoff first\nsecond")).toEqual({ focus: "first\nsecond" });
  });

  it("ignores other messages", () => {
    expect(parseHandoffCommand("/handoffs")).toBeNull();
    expect(parseHandoffCommand("please /handoff")).toBeNull();
    expect(parseHandoffCommand("/side question")).toBeNull();
  });
});

describe("handoffThreadTitle", () => {
  it("marks the new thread as a handoff", () => {
    expect(handoffThreadTitle("Fix login")).toBe("Fix login (handoff)");
    expect(handoffThreadTitle("  ")).toBe("Untitled thread (handoff)");
  });
});

describe("threadHandoffDisabledReason", () => {
  it("waits for the first finished reply", () => {
    expect(threadHandoffDisabledReason([])).toBe("Hand off after the first reply finishes.");
    expect(threadHandoffDisabledReason([{ status: "completed", checkpointId: null }])).toBe(
      "Hand off after the first reply finishes.",
    );
    expect(threadHandoffDisabledReason([{ status: "failed", checkpointId: null }])).toBe(
      "Hand off after the first reply finishes.",
    );
  });

  it("waits for a running turn", () => {
    for (const status of ["preparing", "starting", "running", "waiting"] as const) {
      expect(
        threadHandoffDisabledReason([
          { status: "completed", checkpointId: "checkpoint-1" as never },
          { status, checkpointId: null },
        ]),
      ).toBe("Wait for the current turn to finish, or stop it, before handing off.");
    }
  });

  it("allows a thread with a finished reply and nothing running", () => {
    expect(
      threadHandoffDisabledReason([
        { status: "completed", checkpointId: "checkpoint-1" as never },
        { status: "interrupted", checkpointId: null },
        { status: "queued", checkpointId: null },
      ]),
    ).toBeNull();
  });
});

describe("provider /handoff stays reachable", () => {
  it("T3 handles a typed /handoff", () => {
    expect(resolveHandoffSend({ text: "/handoff tests", pickedProviderCommand: null })).toEqual({
      focus: "tests",
    });
  });

  it("the provider's picked /handoff goes to the provider", () => {
    expect(
      resolveHandoffSend({ text: "/handoff tests", pickedProviderCommand: "handoff" }),
    ).toBeNull();
    // Another picked command does not hide T3's handoff.
    expect(resolveHandoffSend({ text: "/handoff", pickedProviderCommand: "review" })).toEqual({
      focus: "",
    });
  });

  it("forgets the pick once the draft no longer starts with it", () => {
    const picked = { ownerKey: "thread-1", name: "handoff" };
    expect(
      pickedProviderCommandForDraft({ picked, ownerKey: "thread-1", draft: "/handoff now" }),
    ).toBe("handoff");
    expect(pickedProviderCommandForDraft({ picked, ownerKey: "thread-1", draft: "/handoff" })).toBe(
      "handoff",
    );
    expect(
      pickedProviderCommandForDraft({ picked, ownerKey: "thread-1", draft: "/handoffs" }),
    ).toBeNull();
    expect(pickedProviderCommandForDraft({ picked, ownerKey: "thread-1", draft: "" })).toBeNull();
    expect(
      pickedProviderCommandForDraft({ picked, ownerKey: "thread-2", draft: "/handoff" }),
    ).toBeNull();
    expect(
      pickedProviderCommandForDraft({ picked: null, ownerKey: "thread-1", draft: "/handoff" }),
    ).toBeNull();
  });
});
