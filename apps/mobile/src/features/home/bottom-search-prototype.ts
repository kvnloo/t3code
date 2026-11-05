import type { WorkspaceTab } from "../workspace/workspace-tabs-state";

export interface BottomSearchState {
  readonly open: boolean;
  readonly query: string;
}

export type BottomSearchAction =
  | { readonly type: "open" }
  | { readonly type: "dismiss" }
  | { readonly type: "query"; readonly query: string };

export function isBottomSearchAvailable(
  enabled: boolean | undefined,
  rail: boolean,
  splitView: boolean,
  selectedTab: WorkspaceTab,
  settingsOpen: boolean,
) {
  return enabled === true && !rail && !splitView && selectedTab === "threads" && !settingsOpen;
}

export function bottomSearchTransition(
  state: BottomSearchState,
  action: BottomSearchAction,
  enabled: boolean,
): BottomSearchState {
  if (!enabled) return state;
  switch (action.type) {
    case "open":
      return state.open ? state : { ...state, open: true };
    case "dismiss":
      return state.open ? { ...state, open: false } : state;
    case "query":
      return state.query === action.query ? state : { ...state, query: action.query };
  }
}
