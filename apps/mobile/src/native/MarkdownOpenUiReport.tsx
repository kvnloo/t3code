import { lazy, Suspense, useContext, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { RenderErrorBoundary } from "../components/RenderErrorBoundary";
import { AppText } from "../components/ui/AppText";
import { OpenUiImageResolverContext } from "./openUiImageResolver";
import { usePinnedOpenUi } from "./PinnedOpenUiContext";

const Report = lazy(() => import("./OpenUiReport").then((module) => ({ default: module.OpenUiReport })));
const Charts = lazy(() => import("./OpenUiCharts").then((module) => ({ default: module.OpenUiCharts })));

/** Read-only native host for the versioned report (v1, opt-in) and chart board (v2) catalogs. */
export function MarkdownOpenUiReport({ code, version, pinned = false }: { code: string; version: 1 | 2; pinned?: boolean }) {
  const pinning = usePinnedOpenUi();
  const resolver = useContext(OpenUiImageResolverContext);
  const isPinned = pinning?.state.items.some((item) => item.code === code && item.version === version && item.resolver === resolver) ?? false;
  const cannotPin = code.length > 65_536;
  // Chart boards are the answer itself, so they render as soon as the fence completes.
  const [showReport, setShowReport] = useState(version === 2 || pinned);
  const Renderer = version === 2 ? Charts : Report;
  const noun = version === 2 ? "chart" : "report";
  const source = <ScrollView horizontal style={{ maxHeight: 240 }}><AppText selectable className="p-3 font-mono text-xs">{code}</AppText></ScrollView>;
  return (
    <View className="my-3 overflow-hidden rounded-lg border border-border">
      <View className="flex-row items-center justify-between gap-2 border-b border-border px-3 py-2">
        <AppText className="text-xs text-foreground-muted">OpenUI Lab · read-only · v{version}</AppText>
        <View className="flex-row items-center gap-2">
          {pinning && !pinned ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isPinned ? "Pinned to thread dock" : "Pin to thread dock"}
              accessibilityState={{ selected: isPinned, disabled: isPinned || cannotPin }}
              disabled={isPinned || cannotPin}
              onPress={() => pinning.pin(code, version, resolver)}
              className="rounded border border-border px-3 py-2"
            >
              <AppText className="text-sm">{isPinned ? "Pinned" : "Pin"}</AppText>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityState={{ selected: showReport }} onPress={() => setShowReport((value) => !value)} className="rounded border border-border px-3 py-2">
            <AppText className="text-sm">{showReport ? "Show source" : `Render ${noun}`}</AppText>
          </Pressable>
        </View>
      </View>
      {showReport ? <RenderErrorBoundary resetKeys={[code]} renderFallback={() => <><AppText accessibilityRole="alert" className="p-3">{version === 2 ? "Chart" : "Report"} unavailable. Original source:</AppText>{source}</>}>
        <Suspense fallback={<AppText className="p-3">Loading {noun} renderer…</AppText>}><Renderer code={code} /></Suspense>
      </RenderErrorBoundary> : source}
    </View>
  );
}
