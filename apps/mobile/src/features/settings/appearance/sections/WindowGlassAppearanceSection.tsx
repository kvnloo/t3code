import { View } from "react-native";

import { ListChoiceRow as SettingsChoiceRow } from "../../../../components/ui/ListChoiceRow";
import { SettingsSection } from "../../components/SettingsSection";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";

/** Android: see-through app background over the wallpaper, live wallpapers included. */
export function WindowGlassAppearanceSection() {
  const { isReady, windowGlass, windowGlassAvailable, windowGlassBlurSupported, setWindowGlass } =
    useAppearancePreferences();
  if (!windowGlassAvailable) return null;
  return (
    <SettingsSection title="Background">
      <View accessibilityRole="radiogroup">
        <SettingsChoiceRow
          label="Solid"
          description="The theme's background color."
          disabled={!isReady}
          selected={windowGlass === "off"}
          onPress={() => setWindowGlass("off")}
        />
        <SettingsChoiceRow
          label="See-through"
          description="Your wallpaper shows behind the app."
          disabled={!isReady}
          selected={windowGlass === "clear"}
          onPress={() => setWindowGlass("clear")}
          separated
        />
        <SettingsChoiceRow
          label="Frosted"
          description={
            windowGlassBlurSupported
              ? "Your wallpaper shows behind the app, blurred."
              : "Your wallpaper shows behind a deeper tint. This device does not allow window blur."
          }
          disabled={!isReady}
          selected={windowGlass === "frosted"}
          onPress={() => setWindowGlass("frosted")}
          separated
        />
      </View>
    </SettingsSection>
  );
}
