import { type StaticScreenProps } from "@react-navigation/native";
import type { EnvironmentId } from "@t3tools/contracts";
import { ScrollView } from "react-native";
import { SettingsScreen } from "./components/SettingsScreen";
import { ThreadTagsEditor } from "../threads/ThreadTagsEditor";

export function SettingsThreadTagsRouteScreen({ route }: StaticScreenProps<{
  readonly environmentId: EnvironmentId;
  readonly tag?: string;
}>) {
  return (
    <SettingsScreen title="Manage tags">
      <ScrollView keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <ThreadTagsEditor key={`${route.params.environmentId}:${route.params.tag ?? ""}`} environmentId={route.params.environmentId} initialTag={route.params.tag} />
      </ScrollView>
    </SettingsScreen>
  );
}
