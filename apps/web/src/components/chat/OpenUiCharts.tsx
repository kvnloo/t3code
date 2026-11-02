import { createParser } from "@openuidev/lang-core";
import { createLibrary, defineComponent, Renderer } from "@openuidev/react-lang";
import { memo, useMemo, useState } from "react";
import { z } from "zod/v4";

import {
  OPENUI_CHART_DESCRIPTIONS as DESCRIPTIONS,
  OPENUI_CHART_LIMITS as LIMITS,
  OPENUI_CHART_PROMPT,
  OPENUI_SERIES_COLORS,
  bandPoints,
  categoryX,
  buildTreemap,
  findTreemapNode,
  fitLabel,
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
  tailPath,
  treemapReadout,
} from "@t3tools/client-runtime/openui-charts";

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

// Fixed viewBox coordinates; the SVG scales to the message width without measuring.
const MAP_WIDTH = 600;
const MAP_HEIGHT = 260;
const AREA_WIDTH = 600;
const AREA_HEIGHT = 200;

function Readout({ text }: { text: string }) {
  return <p aria-live="polite" className="min-h-10 rounded-md bg-secondary p-2.5 text-xs break-words">{text}</p>;
}

function ScaleLegend({ low, high, caption }: { low: string; high: string; caption: string }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span>{low}</span>
      {[0, 0.33, 0.66, 1].map((step) => <span key={step} aria-hidden className="inline-block h-2.5 w-3.5" style={{ backgroundColor: sequentialColor(step) }} />)}
      <span>{high} · {caption}</span>
    </p>
  );
}

const buttonClass = "min-h-10 rounded-md border border-border px-3 text-sm disabled:opacity-45 aria-pressed:border-primary aria-pressed:bg-accent";

const TreemapPanel = memo(function TreemapPanel({ props }: { props: z.infer<typeof treemapProps> }) {
  const root = useMemo(() => buildTreemap(props.rows), [props.rows]);
  const [path, setPath] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const folder = findTreemapNode(root, path);
  const tiles = useMemo(() => layoutTreemap(folder, MAP_WIDTH, MAP_HEIGHT), [folder]);
  // Shade against the tiles on screen: folder colors are sums, so a file-level scale would saturate them.
  const maxColor = Math.max(0, ...folder.children.map((child) => child.color));
  const shown = selected === null ? folder : findTreemapNode(root, selected);
  return (
    <section aria-label={props.title} className="space-y-2">
      <h4 className="font-semibold">{props.title}</h4>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} disabled={folder === root} onClick={() => { setPath(folder.parent?.path ?? ""); setSelected(null); }}>← Back</button>
        <span className="text-xs text-muted-foreground">{folder.path || "All files"}</span>
      </div>
      <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="group" aria-label={`${props.title} treemap`} className="block h-auto w-full">
        {tiles.map((tile) => {
          const intensity = shade(tile.node.color, maxColor);
          const isFolder = tile.node.children.length > 0;
          const text = treemapReadout(tile.node, props.sizeLabel, props.colorLabel);
          const activate = () => {
            if (isFolder) {
              setPath(tile.node.path);
              setSelected(null);
            } else setSelected(tile.node.path);
          };
          return (
            <g key={tile.node.path} role="button" tabIndex={0} aria-label={`${text}${isFolder ? ", folder, opens" : ""}`} className="cursor-pointer"
              onClick={activate} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } }}>
              <title>{text}</title>
              <rect x={tile.x} y={tile.y} width={tile.width} height={tile.height} fill={sequentialColor(intensity)}
                stroke={selected === tile.node.path ? "#f2c14e" : "rgba(255,255,255,0.85)"} strokeWidth={selected === tile.node.path ? 3 : 1.5} />
              {tile.width > 90 && tile.height > 44 ? <>
                <text x={tile.x + 8} y={tile.y + 22} fill={sequentialLabelColor(intensity)} fontSize={16} fontWeight={600} pointerEvents="none">{fitLabel(`${tile.node.name}${isFolder ? "/" : ""}`, tile.width - 16, 9)}</text>
                <text x={tile.x + 8} y={tile.y + 42} fill={sequentialLabelColor(intensity)} fontSize={14} pointerEvents="none">{fitLabel(`${formatCount(tile.node.size)} ${props.sizeLabel}`, tile.width - 16, 8)}</text>
              </> : tile.width > 40 && tile.height > 24 ? (
                <text x={tile.x + 4} y={tile.y + 16} fill={sequentialLabelColor(intensity)} fontSize={12} fontWeight={600} pointerEvents="none">{fitLabel(`${tile.node.name}${isFolder ? "/" : ""}`, tile.width - 8, 7)}</text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <ScaleLegend low="0" high={formatCount(maxColor)} caption={`area = ${props.sizeLabel}, darker = more ${props.colorLabel}`} />
      <Readout text={treemapReadout(shown, props.sizeLabel, props.colorLabel)} />
    </section>
  );
});

const BarChartPanel = memo(function BarChartPanel({ props }: { props: z.infer<typeof barChartProps> }) {
  const max = Math.max(0, ...props.bars.map((bar) => bar.value));
  return (
    <section aria-label={props.title} className="space-y-2">
      <h4 className="font-semibold">{props.title}</h4>
      <ul className="space-y-2">
        {props.bars.map((bar, index) => (
          <li key={index} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2 text-xs">
            <span className="truncate" title={bar.label}>{tailPath(bar.label, 18)}</span>
            <meter className="h-3 w-full" min={0} max={max || 1} value={bar.value} aria-label={`${bar.label}: ${formatCount(bar.value)} ${props.unit}`} />
            <span className="text-right font-semibold">{formatCount(bar.value)}</span>
          </li>
        ))}
      </ul>
      {props.unit ? <p className="text-xs text-muted-foreground">Values in {props.unit}</p> : null}
    </section>
  );
});

const StackedAreaPanel = memo(function StackedAreaPanel({ props }: { props: z.infer<typeof stackedAreaProps> }) {
  const stack = useMemo(() => stackSeries(props.series, props.categories.length), [props.series, props.categories.length]);
  const [index, setIndex] = useState<number | null>(null);
  return (
    <section aria-label={props.title} className="space-y-2">
      <h4 className="font-semibold">{props.title}</h4>
      <p className="flex flex-wrap gap-3 text-xs">
        {props.series.map((entry, position) => (
          <span key={entry.name} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2.5" style={{ backgroundColor: OPENUI_SERIES_COLORS[position % OPENUI_SERIES_COLORS.length] }} />{entry.name}
          </span>
        ))}
      </p>
      <svg viewBox={`0 0 ${AREA_WIDTH} ${AREA_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`${props.title}, stacked raw counts, peak ${formatCount(stack.max)}`} className="block h-40 w-full">
        {stack.bands.map((band, position) => (
          <polygon key={band.name} points={bandPoints(band.lower, band.upper, stack.max, AREA_WIDTH, AREA_HEIGHT)} fill={OPENUI_SERIES_COLORS[position % OPENUI_SERIES_COLORS.length]} />
        ))}
        {index !== null ? (() => {
          const x = Math.min(AREA_WIDTH - 1, Math.max(1, categoryX(index, props.categories.length, AREA_WIDTH)));
          return <line x1={x} x2={x} y1={0} y2={AREA_HEIGHT} stroke="#f2c14e" strokeWidth={2} vectorEffect="non-scaling-stroke" />;
        })() : null}
      </svg>
      <div className="flex flex-wrap gap-1.5">
        {props.categories.map((category, position) => (
          <button key={`${category}-${position}`} type="button" className={buttonClass} aria-pressed={index === position} onClick={() => setIndex(position)}>{category}</button>
        ))}
      </div>
      <Readout text={index === null ? `Peak ${formatCount(stack.max)}${props.unit ? ` ${props.unit}` : ""}. Choose a category for exact counts.` : stackedReadout(props.categories[index] ?? "", props.series, index, props.unit)} />
    </section>
  );
});

const HeatmapPanel = memo(function HeatmapPanel({ props }: { props: z.infer<typeof heatmapProps> }) {
  const max = useMemo(() => Math.max(0, ...props.counts.flat()), [props.counts]);
  const [cell, setCell] = useState<readonly [number, number] | null>(null);
  const { dense, labelEvery } = heatmapDensity(props.columns.length);
  return (
    <section aria-label={props.title} className="space-y-2">
      <h4 className="font-semibold">{props.title}</h4>
      <div role="group" aria-label={`${props.title} heatmap`} className={dense ? "grid gap-0.5 text-xs" : "grid gap-1 text-xs"} style={{ gridTemplateColumns: `3rem repeat(${props.columns.length}, minmax(0, 1fr))` }}>
        <span />
        {props.columns.map((column, index) => (
          <span key={index} className={dense ? "overflow-visible whitespace-nowrap text-muted-foreground" : "truncate text-center text-muted-foreground"}>
            {index % labelEvery === 0 ? column : null}
          </span>
        ))}
        {props.rows.map((row, rowIndex) => [
          <span key={`label-${rowIndex}`} className="truncate self-center">{row}</span>,
          ...props.columns.map((column, columnIndex) => {
            const value = props.counts[rowIndex]?.[columnIndex] ?? 0;
            const intensity = shade(value, max);
            const active = cell?.[0] === rowIndex && cell[1] === columnIndex;
            return (
              <button key={`${rowIndex}-${columnIndex}`} type="button" aria-label={heatmapReadout(row, column, value, props.unit)} onClick={() => setCell([rowIndex, columnIndex])}
                className={dense ? "min-h-6 min-w-0 rounded-sm" : "min-h-10 min-w-0 rounded font-semibold"} style={{ backgroundColor: sequentialColor(intensity), color: sequentialLabelColor(intensity), outline: active ? "2px solid #f2c14e" : undefined }}>
                {dense ? null : formatCount(value)}
              </button>
            );
          }),
        ])}
      </div>
      <ScaleLegend low="0" high={formatCount(max)} caption={props.unit || "count"} />
      <Readout text={cell === null ? "Choose a cell for its exact count." : heatmapReadout(props.rows[cell[0]] ?? "", props.columns[cell[1]] ?? "", props.counts[cell[0]]?.[cell[1]] ?? 0, props.unit)} />
    </section>
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
    panels: z.array(z.union([Treemap.ref, BarChart.ref, StackedArea.ref, Heatmap.ref])).min(1).max(LIMITS.panels),
  }),
  component: ({ props, renderNode }) => (
    <section aria-label={props.title} className="min-w-0 space-y-5 p-4 text-sm">
      <header>
        <h3 className="font-semibold">{props.title}</h3>
        <p className="whitespace-pre-wrap text-muted-foreground">{props.summary}</p>
      </header>
      {renderNode(props.panels)}
    </section>
  ),
});

const library = createLibrary({ components: [Board, Treemap, BarChart, StackedArea, Heatmap], root: "Board" });
const panelSchemas = {
  Treemap: (value: unknown) => treemapProps.safeParse(value),
  BarChart: (value: unknown) => barChartProps.safeParse(value),
  StackedArea: (value: unknown) => stackedAreaProps.safeParse(value),
  Heatmap: (value: unknown) => heatmapProps.safeParse(value),
};

export const openUiChartPrompt = library.prompt(OPENUI_CHART_PROMPT);

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
  if (status.kind !== "ready") return <p role="status" className="p-4 text-sm text-muted-foreground">{status.reason}</p>;
  // No tool provider, actions or state callbacks: generated content has no action authority.
  return <Renderer response={code} library={library} isStreaming={false} />;
}
