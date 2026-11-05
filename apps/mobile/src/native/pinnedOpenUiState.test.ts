import { describe, expect, it } from "vite-plus/test";

import {
  MAX_PINNED_OPENUI,
  MAX_PINNED_OPENUI_CODE_LENGTH,
  createPinnedOpenUiState,
  pinnedOpenUiReducer,
} from "./pinnedOpenUiState";

const resolver = () => ({ uri: "file:///workspace/images/report.png" });
const otherResolver = () => ({ uri: "file:///other-workspace/images/report.png" });

describe("pinned OpenUI snapshots", () => {
  it("pins, expands, collapses and unpins while retaining image resolver identity", () => {
    const initial = createPinnedOpenUiState("environment-1:thread-1");
    const pinned = pinnedOpenUiReducer(initial, {
      type: "pin", code: "report payload", version: 1, resolver,
    });
    expect(pinned.items).toHaveLength(1);
    expect(pinned.items[0]?.id).toBe(1);
    expect(pinned.items[0]?.resolver).toBe(resolver);
    expect(pinned.expandedId).toBeNull();

    const expanded = pinnedOpenUiReducer(pinned, { type: "expand", id: 1 });
    expect(expanded.expandedId).toBe(1);
    expect(pinnedOpenUiReducer(expanded, { type: "collapse" }).expandedId).toBeNull();

    const unpinned = pinnedOpenUiReducer(expanded, { type: "unpin", id: 1 });
    expect(unpinned.items).toEqual([]);
    expect(unpinned.expandedId).toBeNull();
    expect(pinnedOpenUiReducer(unpinned, { type: "expand", id: 1 })).toBe(unpinned);
  });

  it("deduplicates within a resolver and bounds snapshots to the most recent three", () => {
    let state = createPinnedOpenUiState("environment-1:thread-1");
    state = pinnedOpenUiReducer(state, {
      type: "pin", code: "same data", version: 2, resolver,
    });
    expect(pinnedOpenUiReducer(state, {
      type: "pin", code: "same data", version: 2, resolver,
    })).toBe(state);
    state = pinnedOpenUiReducer(state, {
      type: "pin", code: "same data", version: 2, resolver: otherResolver,
    });
    expect(state.items).toHaveLength(2);
    state = pinnedOpenUiReducer(state, { type: "expand", id: 1 });
    for (let index = 0; index < 4; index++) {
      state = pinnedOpenUiReducer(state, {
        type: "pin", code: "chart " + index, version: 2, resolver,
      });
    }
    expect(state.items).toHaveLength(MAX_PINNED_OPENUI);
    expect(state.items.map((item) => item.code)).toEqual(["chart 1", "chart 2", "chart 3"]);
    expect(state.expandedId).toBeNull();
    expect(state.nextId).toBe(7);
    expect(pinnedOpenUiReducer(state, {
      type: "pin", code: "x".repeat(MAX_PINNED_OPENUI_CODE_LENGTH + 1), version: 1, resolver,
    })).toBe(state);
  });

  it("clears local snapshots on thread or environment change", () => {
    const initial = createPinnedOpenUiState("environment-1:thread-1");
    const pinned = pinnedOpenUiReducer(initial, {
      type: "pin", code: "report", version: 1, resolver,
    });
    expect(pinnedOpenUiReducer(pinned, {
      type: "reset", scopeKey: "environment-1:thread-1",
    })).toBe(pinned);
    const differentThread = pinnedOpenUiReducer(pinned, {
      type: "reset", scopeKey: "environment-1:thread-2",
    });
    expect(differentThread.items).toEqual([]);
    expect(differentThread.nextId).toBe(1);
    const differentEnvironment = pinnedOpenUiReducer(pinned, {
      type: "reset", scopeKey: "environment-2:thread-1",
    });
    expect(differentEnvironment.items).toEqual([]);
    expect(differentEnvironment.scopeKey).toBe("environment-2:thread-1");
  });
});
