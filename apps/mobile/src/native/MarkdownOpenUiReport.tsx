import { lazy, Suspense, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { RenderErrorBoundary } from "../components/RenderErrorBoundary";
import { AppText } from "../components/ui/AppText";

const Report = lazy(() => import("./OpenUiReport").then((module) => ({ default: module.OpenUiReport })));
const Charts = lazy(() => import("./OpenUiCharts").then((module) => ({ default: module.OpenUiCharts })));

/** Read-only native host for the versioned report (v1, opt-in) and chart board (v2) catalogs. */
export function MarkdownOpenUiReport({ code, version }: { code: string; version: 1 | 2 }) {
  // Chart boards are the answer itself, so they render as soon as the fence completes.
  const [showReport, setShowReport] = useState(version === 2);
  const Renderer = version === 2 ? Charts : Report;
  const noun = version === 2 ? "chart" : "report";
  const source = <ScrollView horizontal style={{ maxHeight: 240 }}><AppText selectable className="p-3 font-mono text-xs">{code}</AppText></ScrollView>;
  return (
    <View className="my-3 overflow-hidden rounded-lg border border-border">
      <View className="flex-row items-center justify-between gap-2 border-b border-border px-3 py-2">
        <AppText className="text-xs text-foreground-muted">OpenUI Lab · read-only · v{version}</AppText>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: showReport }} onPress={() => setShowReport((value) => !value)} className="rounded border border-border px-3 py-2">
          <AppText className="text-sm">{showReport ? "Show source" : `Render ${noun}`}</AppText>
        </Pressable>
      </View>
      {showReport ? <RenderErrorBoundary resetKeys={[code]} renderFallback={() => <><AppText accessibilityRole="alert" className="p-3">{version === 2 ? "Chart" : "Report"} unavailable. Original source:</AppText>{source}</>}>
        <Suspense fallback={<AppText className="p-3">Loading {noun} renderer…</AppText>}><Renderer code={code} /></Suspense>
      </RenderErrorBoundary> : source}
    </View>
  );
}
