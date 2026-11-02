import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OpenUiCharts, inspectOpenUiChart, openUiChartPrompt } from "../../apps/web/src/components/chat/OpenUiCharts";

const fences = [...readFileSync(new URL("./source-demo-fences.md", import.meta.url), "utf8").matchAll(/^## (\S+)\n\n```openui-v2\n([\s\S]*?)\n```$/gm)]
  .map((match) => ({ id: match[1]!, code: match[2]! }));

test("all three source-demo answers are ready and render their supplied data", () => {
  assert.deepEqual(fences.map((fence) => fence.id), ["repo-treemap", "model-stacked-area", "activity-heatmap"]);
  const expected: Record<string, RegExp[]> = {
    "repo-treemap": [/All files · 300 LOC · 29 commits/, /login\.ts/, /chat\.ts/, /Top 3 files by churn/, /← Back/],
    "model-stacked-area": [/Codex/, /Claude/, /<polygon/, /Peak 16 turns/, />Tue</],
    "activity-heatmap": [/Tue · 12:00 · 9 turns/, /Mon · 00:00 · 0 turns/, /Wed · 18:00 · 1 turns/],
  };
  for (const fence of fences) {
    assert.deepEqual(inspectOpenUiChart(fence.code), { kind: "ready" }, fence.id);
    const html = renderToStaticMarkup(createElement(OpenUiCharts, { code: fence.code }));
    for (const pattern of expected[fence.id]!) assert.match(html, pattern, `${fence.id} ${pattern}`);
    assert.doesNotMatch(html, /<script|javascript:/i);
  }
  const heat = renderToStaticMarkup(createElement(OpenUiCharts, { code: fences[2]!.code }));
  assert.equal(heat.match(/<button/g)?.length, 12, "every supplied heatmap cell, zeros included, and nothing more");
  assert.match(openUiChartPrompt, /Treemap\(title: string, sizeLabel: string, colorLabel: string, rows:/);
  assert.match(openUiChartPrompt, /openui-v2/);
});

test("rejects malformed, incoherent, unknown and tool-bearing boards", () => {
  const ok = 'root = Board("B", "", [h])\nh = Heatmap("H", "", ["Mon"], ["0"], [[1]])';
  assert.equal(inspectOpenUiChart(ok).kind, "ready");
  for (const code of [
    'root = Board("B", "", [h])',
    'root = Board(',
    'root = Report("B", "", [], [], [], [])',
    'root = Board("B", "", [])',
    'root = Board("B", "", [Unknown("x")])',
    ok + '\ndata = Query("read_file", {})',
    ok + '\nm = Mutation("write_file", {})',
    'root = Board("B", "", [Heatmap("H", "", ["Mon", "Tue"], ["0"], [[1]])])',
    'root = Board("B", "", [Heatmap("H", "", ["Mon"], ["0", "6"], [[1]])])',
    'root = Board("B", "", [Heatmap("H", "", ["Mon"], ["0"], [[-1]])])',
    'root = Board("B", "", [StackedArea("S", "", ["Mon", "Tue"], [{name: "A", values: [1]}])])',
    'root = Board("B", "", [Treemap("T", "LOC", "commits", [{path: "a", size: 1, color: 0}, {path: "a/b", size: 1, color: 0}])])',
    'root = Board("B", "", [Treemap("T", "LOC", "commits", [{path: "a", size: 1, color: 0}, {path: "a", size: 2, color: 0}])])',
    'root = Board("B", "", [BarChart("Bars", "", [])])',
  ]) assert.notEqual(inspectOpenUiChart(code).kind, "ready", code);
});
