import type { MarkdownImageSourceResolver } from "./SelectableMarkdownText.types";

export const MAX_PINNED_OPENUI = 3;
export const MAX_PINNED_OPENUI_CODE_LENGTH = 65_536;

export interface PinnedOpenUiSnapshot {
  readonly id: number;
  readonly code: string;
  readonly version: 1 | 2;
  readonly resolver: MarkdownImageSourceResolver | undefined;
}

export interface PinnedOpenUiState {
  readonly scopeKey: string;
  readonly items: ReadonlyArray<PinnedOpenUiSnapshot>;
  readonly expandedId: number | null;
  readonly nextId: number;
}

export type PinnedOpenUiAction =
  | { readonly type: "pin"; readonly code: string; readonly version: 1 | 2; readonly resolver: MarkdownImageSourceResolver | undefined }
  | { readonly type: "expand"; readonly id: number }
  | { readonly type: "collapse" }
  | { readonly type: "unpin"; readonly id: number }
  | { readonly type: "reset"; readonly scopeKey: string };

export function createPinnedOpenUiState(scopeKey: string): PinnedOpenUiState {
  return { scopeKey, items: [], expandedId: null, nextId: 1 };
}

export function pinnedOpenUiReducer(
  state: PinnedOpenUiState,
  action: PinnedOpenUiAction,
): PinnedOpenUiState {
  switch (action.type) {
    case "reset":
      return state.scopeKey === action.scopeKey ? state : createPinnedOpenUiState(action.scopeKey);
    case "pin": {
      if (action.code.length > MAX_PINNED_OPENUI_CODE_LENGTH) return state;
      if (state.items.some((item) =>
        item.code === action.code &&
        item.version === action.version &&
        item.resolver === action.resolver
      )) return state;
      const items = [
        ...state.items,
        { id: state.nextId, code: action.code, version: action.version, resolver: action.resolver },
      ].slice(-MAX_PINNED_OPENUI);
      return {
        ...state,
        items,
        nextId: state.nextId + 1,
        expandedId: items.some((item) => item.id === state.expandedId) ? state.expandedId : null,
      };
    }
    case "expand":
      return state.items.some((item) => item.id === action.id)
        ? { ...state, expandedId: action.id }
        : state;
    case "collapse":
      return state.expandedId === null ? state : { ...state, expandedId: null };
    case "unpin": {
      if (!state.items.some((item) => item.id === action.id)) return state;
      return {
        ...state,
        items: state.items.filter((item) => item.id !== action.id),
        expandedId: state.expandedId === action.id ? null : state.expandedId,
      };
    }
  }
}
