import { describe, expect, it } from "vite-plus/test";

import {
  nextBottomSearchExpanded,
  resolveBottomSearchMode,
} from "./bottom-search-prototype-state";

describe("bottom search prototype A", () => {
  it("preserves the top search with the toggle off or outside Android Home", () => {
    expect(resolveBottomSearchMode({ enabled: false, active: true, expanded: false })).toBe("top");
    expect(resolveBottomSearchMode({ enabled: false, active: true, expanded: true })).toBe("top");
    expect(resolveBottomSearchMode({ enabled: true, active: false, expanded: true })).toBe("top");
  });

  it("expands the bottom pill and collapses on Back, empty blur, or disable", () => {
    expect(resolveBottomSearchMode({ enabled: true, active: true, expanded: false })).toBe("pill");
    const expanded = nextBottomSearchExpanded(false, "open");
    expect(resolveBottomSearchMode({ enabled: true, active: true, expanded })).toBe("field");
    expect(nextBottomSearchExpanded(expanded, "filled-blur")).toBe(true);
    expect(nextBottomSearchExpanded(expanded, "empty-blur")).toBe(false);
    expect(nextBottomSearchExpanded(expanded, "close")).toBe(false);
    expect(nextBottomSearchExpanded(expanded, "disable")).toBe(false);
  });
});
