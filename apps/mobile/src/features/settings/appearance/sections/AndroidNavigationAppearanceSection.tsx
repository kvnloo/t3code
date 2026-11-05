import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { View } from "react-native";

import { ListChoiceRow as SettingsChoiceRow } from "../../../../components/ui/ListChoiceRow";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../../../state/preferences";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";
import { SettingsSection } from "../../components/SettingsSection";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";

export function AndroidNavigationAppearanceSection() {
  const { isReady, androidNavigationStyle, setAndroidNavigationStyle } = useAppearancePreferences();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const ready = AsyncResult.isSuccess(preferences) && !preferences.waiting;
  const bottomSearchPrototypeA =
    AsyncResult.isSuccess(preferences) && preferences.value.bottomSearchPrototypeA === true;
  return (
    <SettingsSection title="Navigation">
      <View accessibilityRole="radiogroup">
        <SettingsChoiceRow
          label="One UI"
          description="Floating navigation with a separate compose button."
          disabled={!isReady}
          selected={androidNavigationStyle === "one-ui"}
          onPress={() => setAndroidNavigationStyle("one-ui")}
        />
        <SettingsChoiceRow
          label="Material"
          description="Standard Android navigation bar and side rail."
          disabled={!isReady}
          selected={androidNavigationStyle === "material"}
          onPress={() => setAndroidNavigationStyle("material")}
          separated
        />
      </View>
      <SettingsSwitchRow
        icon="magnifyingglass"
        label="Bottom search (prototype A)"
        subtitle="Move Threads search into the bottom navigation on Android phones."
        disabled={!ready}
        value={bottomSearchPrototypeA}
        onValueChange={(value) => savePreferences({ bottomSearchPrototypeA: value })}
      />
    </SettingsSection>
  );
}
