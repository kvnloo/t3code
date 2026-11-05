import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { View } from "react-native";

import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../../../state/preferences";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";

import { ListChoiceRow as SettingsChoiceRow } from "../../../../components/ui/ListChoiceRow";
import { SettingsSection } from "../../components/SettingsSection";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";

export function AndroidNavigationAppearanceSection() {
  const { isReady, androidNavigationStyle, setAndroidNavigationStyle } = useAppearancePreferences();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const ready = isReady && AsyncResult.isSuccess(preferences) && !preferences.waiting;
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
        disabled={!ready}
        icon="magnifyingglass"
        label="Bottom search (prototype B)"
        subtitle="Swipe up on the bottom navigation to search threads."
        value={AsyncResult.isSuccess(preferences) && preferences.value.bottomSearchPrototypeB === true}
        onValueChange={(enabled) => savePreferences({ bottomSearchPrototypeB: enabled })}
      />
    </SettingsSection>
  );
}
