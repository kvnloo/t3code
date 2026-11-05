import { createContext, useContext, useReducer, type ReactNode } from "react";

import type { MarkdownImageSourceResolver } from "./SelectableMarkdownText.types";
import {
  createPinnedOpenUiState,
  pinnedOpenUiReducer,
  type PinnedOpenUiState,
} from "./pinnedOpenUiState";

interface PinnedOpenUiActions {
  readonly state: PinnedOpenUiState;
  readonly pin: (code: string, version: 1 | 2, resolver: MarkdownImageSourceResolver | undefined) => void;
  readonly expand: (id: number) => void;
  readonly collapse: () => void;
  readonly unpin: (id: number) => void;
}

const PinnedOpenUiContext = createContext<PinnedOpenUiActions | null>(null);

export function PinnedOpenUiProvider({
  scopeKey,
  children,
}: {
  scopeKey: string;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(pinnedOpenUiReducer, scopeKey, createPinnedOpenUiState);
  return (
    <PinnedOpenUiContext
      value={{
        state,
        pin: (code, version, resolver) => dispatch({ type: "pin", code, version, resolver }),
        expand: (id) => dispatch({ type: "expand", id }),
        collapse: () => dispatch({ type: "collapse" }),
        unpin: (id) => dispatch({ type: "unpin", id }),
      }}
    >
      {children}
    </PinnedOpenUiContext>
  );
}

export function usePinnedOpenUi() {
  return useContext(PinnedOpenUiContext);
}
