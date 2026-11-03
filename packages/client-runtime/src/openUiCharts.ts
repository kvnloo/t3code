/**
 * Pure layout and validation for the OpenUI chart catalog (`openui-v2` fences).
 *
 * Web and mobile render the same parsed props; this module owns the arithmetic, the catalog
 * wording, the validation rules and the reader-facing readout text so both clients draw and
 * accept identical boards. It has no dependencies: each client binds the schemas to its own
 * zod and OpenUI copies, which keeps duplicate React/zod instances out of either bundle.
 */

import { APP_CARD_EXAMPLE, APP_CARD_PROMPT_RULES, appCardProblem, isAppCardType, type AppCardPanel } from "./openUiAppCards.ts";
import { GALLERY_EXAMPLE, GALLERY_PROMPT_RULE, galleryProblem, type GalleryPanel } from "./openUiGallery.ts";

export const OPENUI_CHART_FENCE = "openui-v2";

/** Bounds every client applies to the schemas. */
export const OPENUI_CHART_LIMITS = {
  title: 200,
  summary: 4_000,
  label: 100,
  unit: 40,
  path: 500,
  value: 1e12,
  panels: 8,
  treemapRows: 500,
  bars: 30,
  categories: 60,
  series: 8,
  heatmapRows: 31,
  heatmapColumns: 48,
  bytes: 65_536,
} as const;

export const OPENUI_CHART_DESCRIPTIONS = {
  Board: "Read-only chart board: a title, a one-paragraph summary, then chart panels in reading order.",
  Treemap: "Nested rectangles from '/'-separated paths. Area is size, darker is color. Readers tap folders to drill in.",
  BarChart: "Horizontal bars of raw non-negative values, drawn relative to the largest bar, in the given order.",
  StackedArea: "Raw counts per category stacked by series. Every series has one value per category.",
  Heatmap: "Grid of counts: one row of counts per row label, one count per column label. Zeros are real cells.",
} as const;

export const OPENUI_CHART_PROMPT = {
  preamble: "Create a read-only T3 chart board using only supplied facts. Never invent, round away or extend data.",
  additionalRules: [
    `Return the program inside an ${OPENUI_CHART_FENCE} fenced code block.`,
    "Do not use Query, Mutation, actions, state, tools or functions. Every argument is a literal. URLs appear only where a component asks for one.",
    "Use each component's arguments in declared order.",
    "StackedArea series need one value per category; Heatmap counts need one row per row label and one count per column label.",
    "After the fenced block include a normal Markdown summary for clients without the renderer.",
    ...APP_CARD_PROMPT_RULES,
    GALLERY_PROMPT_RULE,
  ],
  examples: [
    'root = Board("Churn", "Login is the hottest file.", [map, top])\nmap = Treemap("Size and churn", "LOC", "commits", [{path: "src/login.ts", size: 80, color: 12}, {path: "src/ui.ts", size: 120, color: 4}])\ntop = BarChart("Most commits", "commits", [{label: "login.ts", value: 12}, {label: "ui.ts", value: 4}])',
    APP_CARD_EXAMPLE,
    GALLERY_EXAMPLE,
  ],
};

interface ParsedElement {
  readonly typeName?: unknown;
  readonly props?: unknown;
}

/** The parts of an OpenUI `ParseResult` the host inspects. */
export interface ParsedChartProgram {
  readonly root: ParsedElement | null;
  readonly queryStatements: ReadonlyArray<unknown>;
  readonly mutationStatements: ReadonlyArray<unknown>;
  readonly stateDeclarations: Readonly<Record<string, unknown>>;
  readonly meta: { readonly incomplete: boolean; readonly unresolved: ReadonlyArray<unknown>; readonly errors: ReadonlyArray<unknown> };
}

type SafeParse = (value: unknown) => { readonly success: true; readonly data: unknown } | { readonly success: false };

export type OpenUiChartStatus =
  | { readonly kind: "ready" }
  | { readonly kind: "incomplete" | "invalid"; readonly reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Decide whether a parsed board may render: read-only, complete, schema-valid and coherent. */
/**
 * What a streaming board can show so far: its complete statements, with the root's panel list cut
 * to the panels already defined, so cards appear one by one. Null until the root and one panel
 * are complete. Only for a fence that is still streaming; a finished fence is shown whole or not.
 */
export function streamingChartBoard(code: string): string | null {
  // The last line is still arriving; Markdown hands an open fence over with a newline appended.
  const body = code.replace(/\n$/, "");
  const lines = body.slice(0, body.lastIndexOf("\n") + 1).split("\n").filter((line) => line.trim());
  const defined = new Set(lines.map((line) => /^\s*([A-Za-z_]\w*)\s*=/.exec(line)?.[1]));
  const rootIndex = lines.findIndex((line) => /^\s*root\s*=/.test(line));
  const panels = rootIndex < 0 ? null : /\[([^[\]]*)\]\)\s*$/.exec(lines[rootIndex]!);
  if (!panels) return null;
  const kept = panels[1]!.split(",").map((name) => name.trim()).filter((name) => defined.has(name));
  if (kept.length === 0) return null;
  lines[rootIndex] = `${lines[rootIndex]!.slice(0, panels.index)}[${kept.join(", ")}])`;
  return lines.join("\n");
}

export function inspectParsedChartBoard(
  parsed: ParsedChartProgram,
  panelSchemas: Readonly<Record<ChartPanel["typeName"], SafeParse>>,
): OpenUiChartStatus {
  if (parsed.queryStatements.length || parsed.mutationStatements.length || Object.keys(parsed.stateDeclarations).length) {
    return { kind: "invalid", reason: "This catalog is read-only; tools and state are not supported." };
  }
  if (parsed.meta.incomplete || parsed.meta.unresolved.length || !parsed.root) {
    return { kind: "incomplete", reason: "Chart board is incomplete. The original source remains available." };
  }
  const panels = isRecord(parsed.root.props) && Array.isArray(parsed.root.props.panels) ? parsed.root.props.panels : [];
  if (parsed.meta.errors.length || parsed.root.typeName !== "Board" || panels.length === 0) {
    return { kind: "invalid", reason: "Chart board does not match catalog version 2." };
  }
  for (const panel of panels) {
    const typeName = isRecord(panel) ? panel.typeName : undefined;
    if (typeName !== "Treemap" && typeName !== "BarChart" && typeName !== "StackedArea" && typeName !== "Heatmap" && typeName !== "Gallery" && !isAppCardType(typeName)) {
      return { kind: "invalid", reason: "Chart board contains an unknown panel." };
    }
    const props = panelSchemas[typeName](isRecord(panel) ? panel.props : undefined);
    if (!props.success) return { kind: "invalid", reason: `${typeName} does not match catalog version 2.` };
    const problem = chartPanelProblem({ typeName, props: props.data } as ChartPanel);
    if (problem) return { kind: "invalid", reason: problem };
  }
  return { kind: "ready" };
}

export interface TreemapRow {
  readonly path: string;
  readonly size: number;
  readonly color: number;
}

export interface TreemapNode {
  readonly name: string;
  readonly path: string;
  readonly size: number;
  readonly color: number;
  readonly children: ReadonlyArray<TreemapNode>;
  readonly parent: TreemapNode | null;
}

export interface TreemapTile {
  readonly node: TreemapNode;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface MutableNode {
  name: string;
  path: string;
  size: number;
  color: number;
  children: MutableNode[];
  parent: MutableNode | null;
}

const pathParts = (path: string) => path.split("/").filter((part) => part.length > 0);

/** Folders from '/'-separated paths; a folder's size and color are its descendants' sums. */
export function buildTreemap(rows: ReadonlyArray<TreemapRow>): TreemapNode {
  const root: MutableNode = { name: "", path: "", size: 0, color: 0, children: [], parent: null };
  for (const row of rows) {
    const parts = pathParts(row.path);
    let node = root;
    parts.forEach((part, index) => {
      let child = node.children.find((candidate) => candidate.name === part);
      if (!child) {
        child = { name: part, path: parts.slice(0, index + 1).join("/"), size: 0, color: 0, children: [], parent: node };
        node.children.push(child);
      }
      node = child;
    });
    node.size = row.size;
    node.color = row.color;
  }
  const total = (node: MutableNode) => {
    if (node.children.length === 0) return;
    node.size = 0;
    node.color = 0;
    for (const child of node.children) {
      total(child);
      node.size += child.size;
      node.color += child.color;
    }
  };
  total(root);
  // A folder with one entry costs a tap and shows one full-size tile, so fold it into that entry:
  // home/ > kvn/ > models/ becomes "home/kvn/models/". The root adopts a lone top folder's path.
  const collapse = (node: MutableNode) => {
    for (const [index, child] of node.children.entries()) {
      let merged = child;
      while (merged.children.length === 1) {
        const only = merged.children[0]!;
        merged = { ...only, name: `${merged.name}/${only.name}`, parent: node };
      }
      for (const grandchild of merged.children) grandchild.parent = merged;
      node.children[index] = merged;
      collapse(merged);
    }
  };
  collapse(root);
  if (root.children.length === 1 && root.children[0]!.children.length > 0) {
    const only = root.children[0]!;
    root.path = only.path;
    root.children = only.children;
    for (const child of root.children) child.parent = root;
  }
  return root;
}

/** Find a node by its full path, falling back to the root when it no longer exists. */
export function findTreemapNode(root: TreemapNode, path: string): TreemapNode {
  const target = pathParts(path).join("/");
  let node = root;
  while (node.path !== target) {
    const child = node.children.find((candidate) => target === candidate.path || target.startsWith(`${candidate.path}/`));
    if (!child) return root;
    node = child;
  }
  return node;
}

/** Squarified layout of a node's direct children inside width x height. */
export function layoutTreemap(node: TreemapNode, width: number, height: number): TreemapTile[] {
  const items = node.children.filter((child) => child.size > 0).sort((a, b) => b.size - a.size);
  const total = items.reduce((sum, item) => sum + item.size, 0);
  if (total <= 0 || width <= 0 || height <= 0) return [];
  const scale = (width * height) / total;
  const tiles: TreemapTile[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  const worst = (row: ReadonlyArray<TreemapNode>, side: number) => {
    const areas = row.map((item) => item.size * scale);
    const sum = areas.reduce((acc, area) => acc + area, 0);
    return Math.max(...areas.map((area) => Math.max((side * side * area) / (sum * sum), (sum * sum) / (side * side * area))));
  };
  const place = (row: ReadonlyArray<TreemapNode>) => {
    const sum = row.reduce((acc, item) => acc + item.size * scale, 0);
    if (w >= h) {
      const columnWidth = sum / h;
      let offset = y;
      for (const item of row) {
        const tileHeight = (item.size * scale) / columnWidth;
        tiles.push({ node: item, x, y: offset, width: columnWidth, height: tileHeight });
        offset += tileHeight;
      }
      x += columnWidth;
      w -= columnWidth;
    } else {
      const rowHeight = sum / w;
      let offset = x;
      for (const item of row) {
        const tileWidth = (item.size * scale) / rowHeight;
        tiles.push({ node: item, x: offset, y, width: tileWidth, height: rowHeight });
        offset += tileWidth;
      }
      y += rowHeight;
      h -= rowHeight;
    }
  };
  let row: TreemapNode[] = [];
  for (const item of items) {
    const side = Math.min(w, h);
    if (row.length === 0 || worst([...row, item], side) <= worst(row, side)) {
      row.push(item);
    } else {
      place(row);
      row = [item];
    }
  }
  if (row.length > 0) place(row);
  return tiles;
}

export interface StackedSeries {
  readonly name: string;
  readonly values: ReadonlyArray<number>;
}

/** Raw-count stacking in declared series order; `max` is the tallest column total. */
export function stackSeries(series: ReadonlyArray<StackedSeries>, length: number) {
  const running = Array.from({ length }, () => 0);
  const bands = series.map((entry) => {
    const lower = [...running];
    entry.values.forEach((value, index) => {
      running[index] = (running[index] ?? 0) + value;
    });
    return { name: entry.name, lower, upper: [...running] };
  });
  return { bands, totals: running, max: Math.max(0, ...running) };
}

/** SVG polygon points for one stacked band across evenly spaced categories. */
/** X position of category `index` in a chart `width` wide; matches `bandPoints`. */
export function categoryX(index: number, count: number, width: number) {
  return count > 1 ? (index * width) / (count - 1) : 0;
}

export function bandPoints(lower: ReadonlyArray<number>, upper: ReadonlyArray<number>, max: number, width: number, height: number) {
  const step = upper.length > 1 ? width / (upper.length - 1) : 0;
  const y = (value: number) => (max > 0 ? height - (value / max) * height : height);
  const top = upper.map((value, index) => `${index * step},${y(value)}`);
  const bottom = lower.map((value, index) => `${index * step},${y(value)}`).reverse();
  return [...top, ...bottom].join(" ");
}

/**
 * Heatmaps wider than a dozen columns (hours of a day) drop in-cell numbers and label every
 * `labelEvery`th column; exact values stay one tap away in the readout.
 */
export function heatmapDensity(columns: number) {
  const dense = columns > 12;
  return { dense, labelEvery: dense ? Math.ceil(columns / 8) : 1 };
}

/** 0..1 intensity for a heatmap or treemap value; a zero maximum keeps everything at 0. */
export function shade(value: number, max: number) {
  return max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
}

/** Fixed categorical palette shared by both clients so legends match across surfaces. */
export const OPENUI_SERIES_COLORS = ["#4b9c8b", "#5c83cf", "#c98a3a", "#a15fb5", "#c4566a", "#6f8f3d", "#3f8fb5", "#8a7a5c"] as const;

/** Sequential blue scale from light (0) to dark (1); white labels stay legible from ~0.35. */
export function sequentialColor(intensity: number) {
  return `hsl(213, 55%, ${Math.round(72 - intensity * 44)}%)`;
}

/** Text color for a label drawn on `sequentialColor(intensity)`. */
export function sequentialLabelColor(intensity: number) {
  return intensity >= 0.35 ? "#ffffff" : "#1c2a38";
}

export function formatCount(value: number) {
  return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Truncates a label with an ellipsis so it fits `widthPx` at roughly `charPx` per character (SVG text cannot clip itself). */
export function fitLabel(text: string, widthPx: number, charPx: number) {
  const max = Math.floor(widthPx / charPx);
  if (max <= 0) return "";
  const chars = Array.from(text);
  return chars.length <= max ? text : max === 1 ? "…" : `${chars.slice(0, max - 1).join("")}…`;
}

/** Paths lose their start rather than their file name: "…/models/qwen3-32b.gguf". Other labels are returned as is. */
export function tailPath(label: string, maxChars: number) {
  const chars = Array.from(label);
  if (!label.includes("/") || chars.length <= maxChars || maxChars < 2) return label;
  return `…${chars.slice(chars.length - (maxChars - 1)).join("")}`;
}

const withUnit = (value: number, unit: string) => (unit ? `${formatCount(value)} ${unit}` : formatCount(value));

export function treemapReadout(node: TreemapNode, sizeLabel: string, colorLabel: string) {
  const size = `${node.path || "All files"} · ${formatCount(node.size)} ${sizeLabel}`;
  // Disk-style maps color by the size metric; repeating the same figure adds nothing.
  return colorLabel === sizeLabel && node.color === node.size ? size : `${size} · ${formatCount(node.color)} ${colorLabel}`;
}

export function stackedReadout(category: string, series: ReadonlyArray<StackedSeries>, index: number, unit: string) {
  const parts = series.map((entry) => `${entry.name} ${formatCount(entry.values[index] ?? 0)}`);
  const total = series.reduce((sum, entry) => sum + (entry.values[index] ?? 0), 0);
  return `${category} · ${parts.join(" · ")} · total ${withUnit(total, unit)}`;
}

export function heatmapReadout(row: string, column: string, value: number, unit: string) {
  return `${row} · ${column} · ${withUnit(value, unit)}`;
}

export type ChartPanel =
  | { readonly typeName: "Treemap"; readonly props: { readonly rows: ReadonlyArray<TreemapRow> } }
  | { readonly typeName: "BarChart"; readonly props: { readonly bars: ReadonlyArray<{ readonly label: string; readonly value: number }> } }
  | { readonly typeName: "StackedArea"; readonly props: { readonly categories: ReadonlyArray<string>; readonly series: ReadonlyArray<StackedSeries> } }
  | { readonly typeName: "Heatmap"; readonly props: { readonly rows: ReadonlyArray<string>; readonly columns: ReadonlyArray<string>; readonly counts: ReadonlyArray<ReadonlyArray<number>> } }
  | AppCardPanel
  | GalleryPanel;

/** Cross-field rules the schemas cannot express; returns a reader-facing reason or null. */
export function chartPanelProblem(panel: ChartPanel): string | null {
  switch (panel.typeName) {
    case "Treemap": {
      const paths = new Set<string>();
      for (const row of panel.props.rows) {
        const path = pathParts(row.path).join("/");
        if (path.length === 0) return "Treemap rows need a non-empty path.";
        if (paths.has(path)) return `Treemap path "${path}" appears twice.`;
        paths.add(path);
      }
      for (const path of paths) {
        if ([...paths].some((other) => other.startsWith(`${path}/`))) return `Treemap path "${path}" is both a file and a folder.`;
      }
      return null;
    }
    case "BarChart":
      return null;
    case "StackedArea": {
      const length = panel.props.categories.length;
      const short = panel.props.series.find((entry) => entry.values.length !== length);
      return short ? `StackedArea series "${short.name}" needs ${length} values.` : null;
    }
    case "Heatmap": {
      const { rows, columns, counts } = panel.props;
      if (counts.length !== rows.length) return `Heatmap needs ${rows.length} count rows.`;
      const index = counts.findIndex((row) => row.length !== columns.length);
      return index >= 0 ? `Heatmap row "${rows[index]}" needs ${columns.length} counts.` : null;
    }
    case "Gallery":
      return galleryProblem(panel);
    default:
      return appCardProblem(panel);
  }
}
