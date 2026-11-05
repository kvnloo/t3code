import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { mobilePreferencesAtom } from "../../state/preferences";
import { nextBottomSearchExpanded } from "./bottom-search-prototype-state";

export interface BottomSearchPrototypeModel {
  readonly enabled: boolean;
  readonly expanded: boolean;
  readonly open: () => void;
  readonly close: () => void;
  readonly blur: (query: string) => void;
}

export function useBottomSearchPrototypeModel(eligible: boolean): BottomSearchPrototypeModel {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const enabled =
    Platform.OS === "android" &&
    eligible &&
    AsyncResult.isSuccess(preferences) &&
    preferences.value.bottomSearchPrototypeA === true;
  const [expanded, setExpanded] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- switching off must discard the prototype's open state
  useEffect(() => {
    if (!enabled) setExpanded(false);
  }, [enabled]);

  return {
    enabled,
    expanded: enabled && expanded,
    open: () => {
      if (enabled) setExpanded((current) => nextBottomSearchExpanded(current, "open"));
    },
    close: () => setExpanded((current) => nextBottomSearchExpanded(current, "close")),
    blur: (query) =>
      setExpanded((current) =>
        nextBottomSearchExpanded(current, query.trim() ? "filled-blur" : "empty-blur"),
      ),
  };
}
