import assert from "node:assert/strict";
import test from "node:test";

import {
  bandPoints,
  buildTreemap,
  categoryX,
  chartPanelProblem,
  findTreemapNode,
  fitLabel,
  heatmapReadout,
  layoutTreemap,
  shade,
  stackedReadout,
  stackSeries,
  treemapReadout,
} from "./openUiCharts.ts";

const rows = [
  { path: "src/auth/login.ts", size: 80, color: 12 },
  { path: "src/auth/tokens.ts", size: 40, color: 6 },
  { path: "src/ui/chat.ts", size: 120, color: 4 },
  { path: "tests/auth.test.ts", size: 60, color: 7 },
];

test("treemap folders total their files and tiles keep area proportional to size", () => {
  const root = buildTreemap(rows);
  assert.equal(root.size, 300);
  const src = findTreemapNode(root, "src");
  assert.equal(src.size, 240);
  assert.equal(src.color, 22);
  assert.equal(findTreemapNode(root, "src/auth").path, "src/auth");
  assert.equal(findTreemapNode(root, "gone/away"), root);
  const tiles = layoutTreemap(root, 600, 300);
  const area = tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0);
  assert.ok(Math.abs(area - 600 * 300) < 1e-6);
  for (const tile of tiles) {
    assert.ok(Math.abs((tile.width * tile.height) / (600 * 300) - tile.node.size / 300) < 1e-9, tile.node.path);
    assert.ok(tile.x >= -1e-9 && tile.y >= -1e-9 && tile.x + tile.width <= 600 + 1e-6 && tile.y + tile.height <= 300 + 1e-6);
  }
  assert.deepEqual(layoutTreemap(findTreemapNode(root, "src/auth"), 300, 200).map((tile) => tile.node.name), ["login.ts", "tokens.ts"]);
  assert.equal(treemapReadout(findTreemapNode(root, "src/auth/login.ts"), "LOC", "commits"), "src/auth/login.ts · 80 LOC · 12 commits");
  assert.equal(treemapReadout(root, "LOC", "commits"), "All files · 300 LOC · 29 commits");
});

test("stacked series accumulate raw counts in declared order", () => {
  const series = [{ name: "Codex", values: [8, 4, 10] }, { name: "Claude", values: [4, 10, 6] }];
  const { bands, totals, max } = stackSeries(series, 3);
  assert.deepEqual(bands[1], { name: "Claude", lower: [8, 4, 10], upper: [12, 14, 16] });
  assert.deepEqual(totals, [12, 14, 16]);
  assert.equal(max, 16);
  assert.equal(bandPoints([0, 0, 0], [8, 4, 10], 16, 200, 160), "0,80 100,120 200,60 200,160 100,160 0,160");
  assert.equal(stackedReadout("Tue", series, 1, "turns"), "Tue · Codex 4 · Claude 10 · total 14 turns");
});

test("shade clamps and treats an all-zero grid as empty", () => {
  assert.equal(shade(0, 9), 0);
  assert.equal(shade(9, 9), 1);
  assert.equal(shade(3, 0), 0);
  assert.equal(heatmapReadout("Tue", "12:00 UTC", 0, "turns"), "Tue · 12:00 UTC · 0 turns");
});

test("cross-field problems are reported instead of rendered", () => {
  assert.equal(chartPanelProblem({ typeName: "Treemap", props: { rows } }), null);
  assert.match(chartPanelProblem({ typeName: "Treemap", props: { rows: [...rows, rows[0]!] } })!, /twice/);
  assert.match(chartPanelProblem({ typeName: "Treemap", props: { rows: [{ path: "src", size: 1, color: 0 }, ...rows] } })!, /file and a folder/);
  assert.match(chartPanelProblem({ typeName: "Treemap", props: { rows: [{ path: "//", size: 1, color: 0 }] } })!, /non-empty path/);
  assert.match(chartPanelProblem({ typeName: "StackedArea", props: { categories: ["Mon", "Tue"], series: [{ name: "Codex", values: [1] }] } })!, /needs 2 values/);
  assert.equal(chartPanelProblem({ typeName: "Heatmap", props: { rows: ["Mon"], columns: ["0", "6"], counts: [[0, 0]] } }), null);
  assert.match(chartPanelProblem({ typeName: "Heatmap", props: { rows: ["Mon", "Tue"], columns: ["0"], counts: [[0]] } })!, /2 count rows/);
  assert.match(chartPanelProblem({ typeName: "Heatmap", props: { rows: ["Mon"], columns: ["0", "6"], counts: [[1]] } })!, /needs 2 counts/);
});

test("labels truncate to the space they have", () => {
  assert.equal(fitLabel("tests/", 100, 9), "tests/");
  assert.equal(fitLabel("qwen3-32b.gguf", 60, 9), "qwen3…");
  assert.equal(fitLabel("tokens.ts", 9, 9), "…");
  assert.equal(fitLabel("tokens.ts", 4, 9), "");
});

test("category markers line up with band vertices", () => {
  const points = bandPoints([0, 0, 0], [1, 2, 3], 3, 300, 100).split(" ").slice(0, 3).map((point) => Number(point.split(",")[0]));
  assert.deepEqual([0, 1, 2].map((index) => categoryX(index, 3, 300)), points);
  assert.equal(categoryX(0, 1, 300), 0);
});
