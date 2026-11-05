import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";

import { mobilePreferencesAtom } from "../../state/preferences";

export function useBottomSearchPrototypeB() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  return AsyncResult.isSuccess(preferences) && preferences.value.bottomSearchPrototypeB === true;
}
