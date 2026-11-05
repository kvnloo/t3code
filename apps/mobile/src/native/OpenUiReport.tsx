import { createParser } from "@openuidev/lang-core";
import { createLibrary, defineComponent, Renderer } from "@openuidev/react-lang";
import { ScrollView, View } from "react-native";
import { z } from "zod/v4";

import { AppText } from "../components/ui/AppText";

// Catalog v1 matches the existing web experiment; the host renders native views.
const reportProps = z.object({
  title: z.string().max(200),
  summary: z.string().max(4000),
  metrics: z.array(z.object({ label: z.string().max(100), value: z.string().max(200) })).max(12),
  columns: z.array(z.string().max(100)).max(12),
  rows: z.array(z.array(z.string().max(2000)).max(12)).max(200),
  bars: z.array(z.object({ label: z.string().max(100), value: z.number().min(0).max(100) })).max(20),
});

const Report = defineComponent({
  name: "Report",
  description: "Read-only report. Table rows must match column count. Bars are percentages from 0 to 100. Use empty arrays for unused sections.",
  props: reportProps,
  component: function NativeReport({ props }) {
    return (
      <View style={{ gap: 14, padding: 12 }}>
        <AppText accessibilityRole="header" className="text-lg font-semibold">{props.title}</AppText>
        <AppText selectable className="text-sm text-foreground-muted">{props.summary}</AppText>
        {props.metrics.length > 0 && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {props.metrics.map((metric, index) => <View key={index} className="border border-border" style={{ padding: 10, borderWidth: 1, borderRadius: 8 }}>
            <AppText className="text-xs text-foreground-muted">{metric.label}</AppText>
            <AppText selectable className="text-lg font-semibold">{metric.value}</AppText>
          </View>)}
        </View>}
        {props.columns.length > 0 && <ScrollView horizontal accessibilityLabel={`${props.title} table`}>
          <View>
            <View style={{ flexDirection: "row" }}>
              {props.columns.map((column, index) => <AppText key={index} accessibilityRole="header" className="font-semibold" style={{ width: index === 0 ? 140 : 240, padding: 8 }}>{column}</AppText>)}
            </View>
            {props.rows.map((row, index) => <View key={index} className="border-border" style={{ flexDirection: "row", borderTopWidth: 1 }}>
              {row.map((cell, column) => <AppText key={column} selectable className="text-sm" style={{ width: column === 0 ? 140 : 240, padding: 8 }}>{cell}</AppText>)}
            </View>)}
          </View>
        </ScrollView>}
        {props.bars.map((bar, index) => <View key={index} accessible accessibilityRole="progressbar" accessibilityLabel={bar.label} accessibilityValue={{ min: 0, max: 100, now: bar.value }} style={{ gap: 4 }}>
          <AppText>{bar.label} · {bar.value}%</AppText>
          <View className="bg-border" style={{ height: 8, borderRadius: 4 }}>
            <View className="bg-primary" style={{ height: 8, width: `${bar.value}%`, borderRadius: 4 }} />
          </View>
        </View>)}
      </View>
    );
  },
});

const library = createLibrary({ components: [Report], root: "Report" });

export function inspectOpenUiReport(code: string) {
  if (code.length > 65_536) return { kind: "invalid", reason: "Report exceeds the 64 KiB limit." } as const;
  try {
    const parsed = createParser(library.toJSONSchema(), library.root).parse(code);
    if (parsed.queryStatements.length || parsed.mutationStatements.length || Object.keys(parsed.stateDeclarations).length) {
      return { kind: "invalid", reason: "This catalog is read-only; tools and state are not supported." } as const;
    }
    if (parsed.meta.incomplete || parsed.meta.unresolved.length || !parsed.root) {
      return { kind: "incomplete", reason: "Report is incomplete. The original source remains available." } as const;
    }
    const props = reportProps.safeParse(parsed.root.props);
    if (parsed.meta.errors.length || parsed.root.typeName !== "Report" || !props.success || props.data.rows.some((row) => row.length !== props.data.columns.length)) {
      return { kind: "invalid", reason: "Report does not match catalog version 1." } as const;
    }
    return { kind: "ready" } as const;
  } catch {
    return { kind: "invalid", reason: "Report could not be parsed. The original source remains available." } as const;
  }
}

export function OpenUiReport({ code }: { code: string }) {
  const status = inspectOpenUiReport(code);
  if (status.kind !== "ready") return <AppText accessibilityRole="alert" className="p-3 text-sm text-foreground-muted">{status.reason}</AppText>;
  return <Renderer response={code} library={library} isStreaming={false} />;
}
