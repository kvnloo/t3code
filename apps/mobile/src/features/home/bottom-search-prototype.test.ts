import { describe, expect, it } from "vite-plus/test";

import { bottomSearchTransition, isBottomSearchAvailable } from "./bottom-search-prototype";

describe("bottom search prototype B", () => {
  it("keeps the existing navigation and search when the setting is off", () => {
    const state = { open: false, query: "existing search" };
    expect(isBottomSearchAvailable(undefined, false, false, "threads", false)).toBe(false);
    expect(isBottomSearchAvailable(false, false, false, "threads", false)).toBe(false);
    expect(bottomSearchTransition(state, { type: "open" }, false)).toBe(state);
    expect(bottomSearchTransition(state, { type: "query", query: "replacement" }, false)).toBe(
      state,
    );
    expect(state).toEqual({ open: false, query: "existing search" });
  });

  it("only opens on the phone's thread navigation tab", () => {
    expect(isBottomSearchAvailable(true, false, false, "threads", false)).toBe(true);
    expect(isBottomSearchAvailable(true, true, false, "threads", false)).toBe(false);
    expect(isBottomSearchAvailable(true, false, true, "threads", false)).toBe(false);
    expect(isBottomSearchAvailable(true, false, false, "pullRequests", false)).toBe(false);
    expect(isBottomSearchAvailable(true, false, false, "threads", true)).toBe(false);
  });

  it("opens, dismisses and reopens without clearing the shared query", () => {
    const initial = { open: false, query: "" };
    const open = bottomSearchTransition(initial, { type: "open" }, true);
    const typed = bottomSearchTransition(open, { type: "query", query: "fuzzy search" }, true);
    const dismissed = bottomSearchTransition(typed, { type: "dismiss" }, true);
    const reopened = bottomSearchTransition(dismissed, { type: "open" }, true);
    expect(initial).toEqual({ open: false, query: "" });
    expect(open).toEqual({ open: true, query: "" });
    expect(typed).toEqual({ open: true, query: "fuzzy search" });
    expect(dismissed).toEqual({ open: false, query: "fuzzy search" });
    expect(reopened).toEqual({ open: true, query: "fuzzy search" });
  });
});
