export type BottomSearchMode = "top" | "pill" | "field";

export function resolveBottomSearchMode(options: {
  readonly enabled: boolean;
  readonly active: boolean;
  readonly expanded: boolean;
}): BottomSearchMode {
  if (!options.enabled || !options.active) return "top";
  return options.expanded ? "field" : "pill";
}

export type BottomSearchEvent = "open" | "close" | "disable" | "empty-blur" | "filled-blur";

export function nextBottomSearchExpanded(expanded: boolean, event: BottomSearchEvent): boolean {
  if (event === "open") return true;
  if (event === "filled-blur") return expanded;
  return false;
}
