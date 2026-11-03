import { GuestShareCreateError } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildThreadShareActions, guestShareCreateFailureMessage } from "./threadShareMenu";

describe("buildThreadShareActions", () => {
  it("offers handoff and a guest link on an idle thread", () => {
    const actions = buildThreadShareActions({
      canOperateThread: true,
      handoffDisabledReason: null,
      canCreateGuestShare: true,
      hasGuestShare: false,
    });
    expect(actions.map((action) => [action.id, action.title, action.disabled ?? false])).toEqual([
      ["handoff", "Hand off to new thread", false],
      ["share-guest", "Share with guest", false],
    ]);
  });

  it("shows why handoff is not available yet", () => {
    const [handoff] = buildThreadShareActions({
      canOperateThread: true,
      handoffDisabledReason: "Hand off after the first reply finishes.",
      canCreateGuestShare: false,
      hasGuestShare: false,
    });
    expect(handoff).toMatchObject({
      id: "handoff",
      disabled: true,
      subtitle: "Hand off after the first reply finishes.",
    });
  });

  it("offers a replacement link and the way out while a share is active", () => {
    const actions = buildThreadShareActions({
      canOperateThread: true,
      handoffDisabledReason: null,
      canCreateGuestShare: true,
      hasGuestShare: true,
    });
    expect(actions.map((action) => action.title)).toEqual([
      "Hand off to new thread",
      "New guest link",
      "Stop sharing",
    ]);
    expect(actions.at(-1)?.destructive).toBe(true);
  });

  it("keeps Stop sharing without permission to create links", () => {
    const actions = buildThreadShareActions({
      canOperateThread: true,
      handoffDisabledReason: null,
      canCreateGuestShare: false,
      hasGuestShare: true,
    });
    expect(actions.map((action) => action.id)).toEqual(["handoff", "stop-guest-share"]);
  });

  it("offers nothing to a viewer who cannot operate the thread", () => {
    expect(
      buildThreadShareActions({
        canOperateThread: false,
        handoffDisabledReason: null,
        canCreateGuestShare: true,
        hasGuestShare: true,
      }),
    ).toEqual([]);
  });
});

describe("guestShareCreateFailureMessage", () => {
  it("tells the user where to turn guest links on", () => {
    expect(guestShareCreateFailureMessage(new GuestShareCreateError({ reason: "disabled" }))).toBe(
      "Guest links are off on this machine. Turn on Settings > Labs > Guest links in T3 Code on the computer running it, then try again.",
    );
    // RPC failures can arrive as plain tagged objects.
    expect(
      guestShareCreateFailureMessage({
        _tag: "GuestShareCreateError",
        reason: "connect_unavailable",
      }),
    ).toBe(
      "Guest links need T3 Connect. Start T3 Connect on the computer running T3 Code, then try again.",
    );
  });

  it("falls back to the error's own message", () => {
    expect(guestShareCreateFailureMessage(new Error("Socket closed"))).toBe("Socket closed");
    expect(guestShareCreateFailureMessage(undefined)).toBe("Could not create a guest link.");
    expect(
      guestShareCreateFailureMessage({ _tag: "GuestShareCreateError", reason: "unknown" }),
    ).toBe("Could not create a guest link.");
  });
});
