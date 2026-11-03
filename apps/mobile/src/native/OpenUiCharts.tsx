import { createParser } from "@openuidev/lang-core";
import { createLibrary, defineComponent, Renderer } from "@openuidev/react-lang";
import { memo, useMemo, useState } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import Svg, { Line, Polygon } from "react-native-svg";
import { z } from "zod/v4";

import {
  OPENUI_CHART_DESCRIPTIONS as DESCRIPTIONS,
  OPENUI_CHART_LIMITS as LIMITS,
  OPENUI_SERIES_COLORS,
  bandPoints,
  categoryX,
  buildTreemap,
  findTreemapNode,
  formatCount,
  heatmapDensity,
  heatmapReadout,
  inspectParsedChartBoard,
  layoutTreemap,
  sequentialColor,
  sequentialLabelColor,
  shade,
  stackSeries,
  stackedReadout,
  treemapReadout,
} from "@t3tools/client-runtime/openui-charts";

import { AppText } from "../components/ui/AppText";
import { MailList, PullRequest, RideOptions, Route, appCardSchemas } from "./OpenUiAppCards";

// Catalog v2: the shared definition in client-runtime bound to this app's zod and OpenUI.
const title = z.string().max(LIMITS.title);
const label = z.string().min(1).max(LIMITS.label);
const unit = z.string().max(LIMITS.unit);
const count = z.number().finite().min(0).max(LIMITS.value);
const treemapProps = z.object({
  title,
  sizeLabel: label,
  colorLabel: label,
  rows: z.array(z.object({ path: z.string().min(1).max(LIMITS.path), size: count, color: count })).min(1).max(LIMITS.treemapRows),
});
const barChartProps = z.object({ title, unit, bars: z.array(z.object({ label, value: count })).min(1).max(LIMITS.bars) });
const stackedAreaProps = z.object({
  title,
  unit,
  categories: z.array(label).min(2).max(LIMITS.categories),
  series: z.array(z.object({ name: label, values: z.array(count).max(LIMITS.categories) })).min(1).max(LIMITS.series),
});
const heatmapProps = z.object({
  title,
  unit,
  rows: z.array(label).min(1).max(LIMITS.heatmapRows),
  columns: z.array(label).min(1).max(LIMITS.heatmapColumns),
  counts: z.array(z.array(count).max(LIMITS.heatmapColumns)).max(LIMITS.heatmapRows),
});

const TREEMAP_HEIGHT = 220;
const AREA_HEIGHT = 160;

function useWidth() {
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next !== width) setWidth(next);
  };
  return [width, onLayout] as const;
}

function PanelTitle({ children }: { children: string }) {
  return <AppText accessibilityRole="header" className="text-base font-semibold">{children}</AppText>;
}

function Readout({ text }: { text: string }) {
  return (
    <View accessibilityLiveRegion="polite" className="rounded-md bg-secondary" style={{ padding: 10, minHeight: 40 }}>
      <AppText selectable className="text-xs">{text}</AppText>
    </View>
  );
}

function Button({ label: text, onPress, disabled, selected }: { label: string; onPress: () => void; disabled?: boolean; selected?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(selected) }}
      disabled={disabled}
      onPress={onPress}
      className={selected ? "rounded-md border border-primary bg-subtle" : "rounded-md border border-border"}
      style={{ minHeight: 40, paddingHorizontal: 12, justifyContent: "center", opacity: disabled ? 0.45 : 1 }}
    >
      <AppText className="text-sm">{text}</AppText>
    </Pressable>
  );
}

function ScaleLegend({ low, high, caption }: { low: string; high: string; caption: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <AppText className="text-xs text-foreground-muted">{low}</AppText>
      {[0, 0.33, 0.66, 1].map((step) => <View key={step} style={{ width: 14, height: 10, backgroundColor: sequentialColor(step) }} />)}
      <AppText className="text-xs text-foreground-muted">{high} · {caption}</AppText>
    </View>
  );
}

const TreemapPanel = memo(function TreemapPanel({ props }: { props: z.infer<typeof treemapProps> }) {
  const root = useMemo(() => buildTreemap(props.rows), [props.rows]);
  const [path, setPath] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [width, onLayout] = useWidth();
  const folder = findTreemapNode(root, path);
  const tiles = useMemo(() => layoutTreemap(folder, width, TREEMAP_HEIGHT), [folder, width]);
  // Shade against the tiles on screen: folder colors are sums, so a file-level scale would saturate them.
  const maxColor = Math.max(0, ...folder.children.map((child) => child.color));
  const shown = selected === null ? folder : findTreemapNode(root, selected);
  return (
    <View style={{ gap: 8 }}>
      <PanelTitle>{props.title}</PanelTitle>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Button label="← Back" disabled={folder === root} onPress={() => { setPath(folder.parent?.path ?? ""); setSelected(null); }} />
        <AppText className="text-xs text-foreground-muted">{folder.path || "All files"}</AppText>
      </View>
      <View onLayout={onLayout} accessibilityLabel={`${props.title} treemap`} style={{ height: TREEMAP_HEIGHT }}>
        {tiles.map((tile) => {
          const intensity = shade(tile.node.color, maxColor);
          const isFolder = tile.node.children.length > 0;
          // Full label when it fits, name only for narrow tiles, nothing for slivers (tap still reads out).
          const label = tile.width > 70 && tile.height > 34 ? "full" : tile.width > 30 && tile.height > 20 ? "name" : "none";
          return (
            <Pressable
              key={tile.node.path}
              accessibilityRole="button"
              accessibilityLabel={`${treemapReadout(tile.node, props.sizeLabel, props.colorLabel)}${isFolder ? ", folder, opens" : ""}`}
              onPress={() => {
                if (isFolder) {
                  setPath(tile.node.path);
                  setSelected(null);
                } else setSelected(tile.node.path);
              }}
              style={{
                position: "absolute",
                left: tile.x,
                top: tile.y,
                width: tile.width,
                height: tile.height,
                padding: label === "full" ? 6 : 3,
                borderWidth: selected === tile.node.path ? 2 : 1,
                borderColor: selected === tile.node.path ? "#f2c14e" : "rgba(255,255,255,0.85)",
                backgroundColor: sequentialColor(intensity),
              }}
            >
              {label !== "none" ? <AppText numberOfLines={1} style={{ color: sequentialLabelColor(intensity), fontSize: label === "full" ? 12 : 10, fontWeight: "600" }}>{tile.node.name}{isFolder ? "/" : ""}</AppText> : null}
              {label === "full" ? <AppText numberOfLines={1} style={{ color: sequentialLabelColor(intensity), fontSize: 11 }}>{formatCount(tile.node.size)} {props.sizeLabel}</AppText> : null}
            </Pressable>
          );
        })}
      </View>
      <ScaleLegend low="0" high={formatCount(maxColor)} caption={`area = ${props.sizeLabel}, darker = more ${props.colorLabel}`} />
      <Readout text={treemapReadout(shown, props.sizeLabel, props.colorLabel)} />
    </View>
  );
});

const BarChartPanel = memo(function BarChartPanel({ props }: { props: z.infer<typeof barChartProps> }) {
  const max = Math.max(0, ...props.bars.map((bar) => bar.value));
  return (
    <View style={{ gap: 8 }}>
      <PanelTitle>{props.title}</PanelTitle>
      {props.bars.map((bar, index) => (
        <View key={index} accessible accessibilityLabel={`${bar.label}: ${formatCount(bar.value)} ${props.unit}`} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <AppText numberOfLines={1} ellipsizeMode={bar.label.includes("/") ? "head" : "tail"} className="text-xs" style={{ width: 104 }}>{bar.label}</AppText>
          <View className="bg-secondary" style={{ flex: 1, height: 12, borderRadius: 3, overflow: "hidden" }}>
            <View style={{ height: 12, width: `${shade(bar.value, max) * 100}%`, backgroundColor: OPENUI_SERIES_COLORS[0] }} />
          </View>
          <AppText className="text-xs font-semibold" style={{ minWidth: 36, textAlign: "right" }}>{formatCount(bar.value)}</AppText>
        </View>
      ))}
      {props.unit ? <AppText className="text-xs text-foreground-muted">Values in {props.unit}</AppText> : null}
    </View>
  );
});

const StackedAreaPanel = memo(function StackedAreaPanel({ props }: { props: z.infer<typeof stackedAreaProps> }) {
  const stack = useMemo(() => stackSeries(props.series, props.categories.length), [props.series, props.categories.length]);
  const [index, setIndex] = useState<number | null>(null);
  const [width, onLayout] = useWidth();
  return (
    <View style={{ gap: 8 }}>
      <PanelTitle>{props.title}</PanelTitle>
      <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
        {props.series.map((entry, position) => (
          <View key={entry.name} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 11, height: 11, backgroundColor: OPENUI_SERIES_COLORS[position % OPENUI_SERIES_COLORS.length] }} />
            <AppText className="text-xs">{entry.name}</AppText>
          </View>
        ))}
      </View>
      <View onLayout={onLayout} accessibilityLabel={`${props.title}, stacked raw counts, peak ${formatCount(stack.max)}`} style={{ height: AREA_HEIGHT }}>
        {width > 0 ? (
          <Svg width={width} height={AREA_HEIGHT}>
            {stack.bands.map((band, position) => (
              <Polygon key={band.name} points={bandPoints(band.lower, band.upper, stack.max, width, AREA_HEIGHT)} fill={OPENUI_SERIES_COLORS[position % OPENUI_SERIES_COLORS.length]} />
            ))}
            {index !== null ? (() => {
              const x = Math.min(width - 1, Math.max(1, categoryX(index, props.categories.length, width)));
              return <Line x1={x} x2={x} y1={0} y2={AREA_HEIGHT} stroke="#f2c14e" strokeWidth={2} />;
            })() : null}
          </Svg>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        {props.categories.map((category, position) => (
          <Button key={`${category}-${position}`} label={category} selected={index === position} onPress={() => setIndex(position)} />
        ))}
      </View>
      <Readout text={index === null ? `Peak ${formatCount(stack.max)}${props.unit ? ` ${props.unit}` : ""}. Tap a category for exact counts.` : stackedReadout(props.categories[index] ?? "", props.series, index, props.unit)} />
    </View>
  );
});

const HeatmapPanel = memo(function HeatmapPanel({ props }: { props: z.infer<typeof heatmapProps> }) {
  const max = useMemo(() => Math.max(0, ...props.counts.flat()), [props.counts]);
  const [cell, setCell] = useState<readonly [number, number] | null>(null);
  const { dense, labelEvery } = heatmapDensity(props.columns.length);
  const gap = dense ? 2 : 4;
  return (
    <View style={{ gap: 8 }}>
      <PanelTitle>{props.title}</PanelTitle>
      <View accessibilityLabel={`${props.title} heatmap`} style={{ gap }}>
        <View style={{ flexDirection: "row", gap }}>
          <View style={{ width: 44 }} />
          {props.columns.map((column, index) => (
            // Dense labels may overflow their 1/24 slot; they start at their column and skip the next few.
            <View key={index} style={{ flex: 1, overflow: "visible" }}>
              {index % labelEvery === 0 ? <AppText numberOfLines={1} className="text-xs text-foreground-muted" style={dense ? { width: 40 } : { textAlign: "center" }}>{column}</AppText> : null}
            </View>
          ))}
        </View>
        {props.rows.map((row, rowIndex) => (
          <View key={rowIndex} style={{ flexDirection: "row", gap, alignItems: "center" }}>
            <AppText numberOfLines={1} className="text-xs" style={{ width: 44 }}>{row}</AppText>
            {props.columns.map((column, columnIndex) => {
              const value = props.counts[rowIndex]?.[columnIndex] ?? 0;
              const intensity = shade(value, max);
              const active = cell?.[0] === rowIndex && cell[1] === columnIndex;
              return (
                <Pressable
                  key={columnIndex}
                  accessibilityRole="button"
                  accessibilityLabel={heatmapReadout(row, column, value, props.unit)}
                  onPress={() => setCell([rowIndex, columnIndex])}
                  style={{ flex: 1, minHeight: dense ? 22 : 40, borderRadius: dense ? 2 : 4, alignItems: "center", justifyContent: "center", backgroundColor: sequentialColor(intensity), borderWidth: active ? 2 : 0, borderColor: "#f2c14e" }}
                >
                  {dense ? null : <AppText style={{ color: sequentialLabelColor(intensity), fontSize: 12, fontWeight: "600" }}>{formatCount(value)}</AppText>}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      <ScaleLegend low="0" high={formatCount(max)} caption={props.unit || "count"} />
      <Readout text={cell === null ? "Tap a cell for its exact count." : heatmapReadout(props.rows[cell[0]] ?? "", props.columns[cell[1]] ?? "", props.counts[cell[0]]?.[cell[1]] ?? 0, props.unit)} />
    </View>
  );
});

const Treemap = defineComponent({ name: "Treemap", description: DESCRIPTIONS.Treemap, props: treemapProps, component: TreemapPanel });
const BarChart = defineComponent({ name: "BarChart", description: DESCRIPTIONS.BarChart, props: barChartProps, component: BarChartPanel });
const StackedArea = defineComponent({ name: "StackedArea", description: DESCRIPTIONS.StackedArea, props: stackedAreaProps, component: StackedAreaPanel });
const Heatmap = defineComponent({ name: "Heatmap", description: DESCRIPTIONS.Heatmap, props: heatmapProps, component: HeatmapPanel });
const Board = defineComponent({
  name: "Board",
  description: DESCRIPTIONS.Board,
  props: z.object({
    title,
    summary: z.string().max(LIMITS.summary),
    panels: z.array(z.union([Treemap.ref, BarChart.ref, StackedArea.ref, Heatmap.ref, RideOptions.ref, MailList.ref, Route.ref, PullRequest.ref])).min(1).max(LIMITS.panels),
  }),
  component: function NativeBoard({ props, renderNode }) {
    return (
      <View style={{ gap: 18, padding: 12 }}>
        <View style={{ gap: 4 }}>
          <AppText accessibilityRole="header" className="text-lg font-semibold">{props.title}</AppText>
          <AppText selectable className="text-sm text-foreground-muted">{props.summary}</AppText>
        </View>
        {renderNode(props.panels)}
      </View>
    );
  },
});

const library = createLibrary({ components: [Board, Treemap, BarChart, StackedArea, Heatmap, RideOptions, MailList, Route, PullRequest], root: "Board" });
const panelSchemas = {
  Treemap: (value: unknown) => treemapProps.safeParse(value),
  BarChart: (value: unknown) => barChartProps.safeParse(value),
  StackedArea: (value: unknown) => stackedAreaProps.safeParse(value),
  Heatmap: (value: unknown) => heatmapProps.safeParse(value),
  ...appCardSchemas,
};

export function inspectOpenUiChart(code: string) {
  if (code.length > LIMITS.bytes) return { kind: "invalid", reason: "Chart board exceeds the 64 KiB limit." } as const;
  try {
    return inspectParsedChartBoard(createParser(library.toJSONSchema(), library.root).parse(code), panelSchemas);
  } catch {
    return { kind: "invalid", reason: "Chart board could not be parsed. The original source remains available." } as const;
  }
}

export function OpenUiCharts({ code }: { code: string }) {
  const status = useMemo(() => inspectOpenUiChart(code), [code]);
  if (status.kind !== "ready") return <AppText accessibilityRole="alert" className="p-3 text-sm text-foreground-muted">{status.reason}</AppText>;
  // No tool provider, actions or state callbacks: generated content has no action authority.
  return <Renderer response={code} library={library} isStreaming={false} />;
}
