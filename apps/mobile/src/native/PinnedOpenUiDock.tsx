import { Keyboard, Pressable, ScrollView, View } from "react-native";

import { AppText } from "../components/ui/AppText";
import { MarkdownOpenUiReport } from "./MarkdownOpenUiReport";
import { OpenUiImageResolverContext } from "./openUiImageResolver";
import { usePinnedOpenUi } from "./PinnedOpenUiContext";

export function PinnedOpenUiDock({
  keyboardVisible,
  maxHeight,
}: {
  keyboardVisible: boolean;
  maxHeight: number;
}) {
  const pinning = usePinnedOpenUi();
  if (!pinning || pinning.state.items.length === 0) return null;

  const { items, expandedId } = pinning.state;
  const expanded = keyboardVisible ? undefined : items.find((item) => item.id === expandedId);

  return (
    <View className="mb-2 rounded-lg border border-border bg-background px-2 py-2">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 6 }}
      >
        {items.map((item, index) => {
          const name = item.version === 2 ? "chart" : "report";
          const label = "Pinned " + name + " " + (index + 1);
          const isExpanded = expanded?.id === item.id;
          return (
            <View key={item.id} className="flex-row items-center rounded-full border border-border bg-secondary">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={(isExpanded ? "Collapse " : "Expand ") + label}
                accessibilityState={{ expanded: isExpanded }}
                onPress={() => {
                  Keyboard.dismiss();
                  if (isExpanded) pinning.collapse();
                  else pinning.expand(item.id);
                }}
                style={{ minHeight: 40, justifyContent: "center", paddingLeft: 12, paddingRight: 6 }}
              >
                <AppText className="text-xs font-semibold">{name === "chart" ? "Chart" : "Report"} {index + 1}</AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={"Unpin " + label}
                onPress={() => pinning.unpin(item.id)}
                style={{ minHeight: 40, minWidth: 38, alignItems: "center", justifyContent: "center" }}
              >
                <AppText className="text-base">×</AppText>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
      {expanded ? (
        <View style={{ maxHeight: Math.min(300, maxHeight), marginTop: 8, overflow: "hidden" }}>
          <View className="flex-row items-center justify-between px-2 py-1">
            <AppText className="text-xs font-semibold text-foreground-muted">Pinned snapshot</AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Collapse pinned snapshot"
              onPress={pinning.collapse}
              style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: 10 }}
            >
              <AppText className="text-sm">Collapse</AppText>
            </Pressable>
          </View>
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            style={{ flexShrink: 1 }}
          >
            <OpenUiImageResolverContext value={expanded.resolver}>
              <MarkdownOpenUiReport
                key={expanded.id}
                code={expanded.code}
                version={expanded.version}
                pinned
              />
            </OpenUiImageResolverContext>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
