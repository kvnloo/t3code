import { lazy, Suspense, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { RenderErrorBoundary } from "../components/RenderErrorBoundary";
import { AppText } from "../components/ui/AppText";

const Report = lazy(() => import("./OpenUiReport").then((module) => ({ default: module.OpenUiReport })));

/** Read-only native host for the existing versioned web report catalog. */
export function MarkdownOpenUiReport({ code }: { code: string }) {
  const [showReport, setShowReport] = useState(false);
  const source = <ScrollView horizontal style={{ maxHeight: 240 }}><AppText selectable className="p-3 font-mono text-xs">{code}</AppText></ScrollView>;
  return (
    <View className="my-3 overflow-hidden rounded-lg border border-border">
      <View className="flex-row items-center justify-between gap-2 border-b border-border px-3 py-2">
        <AppText className="text-xs text-foreground-muted">OpenUI Lab · read-only · v1</AppText>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: showReport }} onPress={() => setShowReport((value) => !value)} className="rounded border border-border px-3 py-2">
          <AppText className="text-sm">{showReport ? "Show source" : "Render report"}</AppText>
        </Pressable>
      </View>
      {showReport ? <RenderErrorBoundary resetKeys={[code]} renderFallback={() => <><AppText accessibilityRole="alert" className="p-3">Report unavailable. Original source:</AppText>{source}</>}>
        <Suspense fallback={<AppText className="p-3">Loading report renderer…</AppText>}><Report code={code} /></Suspense>
      </RenderErrorBoundary> : source}
    </View>
  );
}
