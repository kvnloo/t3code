import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OpenUiCharts, inspectOpenUiChart, openUiChartPrompt } from "../../apps/web/src/components/chat/OpenUiCharts";

const slides = [
  { image: "/shots/terminal.jpg", title: "Terminal", caption: "Overview", group: "Terminal", tags: [{ text: "Rust · egui", tone: "ok" }, { text: "no licence", tone: "bad" }], note: "Best design.", link: "https://github.com/michaelshimeles/terminal" },
  { image: "/shots/amber.jpg", title: "Terminal", caption: "Amber theme", group: "Terminal" },
  { image: "https://example.com/kerosene.png", title: "Kerosene", group: "Kerosene" },
];
const board = (items: unknown) => `root = Board("Picks", "Screenshots.", [shots])\nshots = Gallery("Trading terminals", ${JSON.stringify(items)})`;

test("a Gallery board is ready and renders its first slide, counter, tags and thumbnails", () => {
  assert.deepEqual(inspectOpenUiChart(board(slides)), { kind: "ready" });
  const html = renderToStaticMarkup(createElement(OpenUiCharts, { code: board(slides) }));
  for (const pattern of [/data-openui-gallery/, /aria-roledescription="carousel"/, /1 \/ 3/, /Rust · egui/, /no licence/, /Best design\./, /\/shots\/terminal\.jpg/, /href="https:\/\/github\.com\/michaelshimeles\/terminal"/])
    assert.match(html, pattern);
  assert.equal(html.match(/aria-roledescription="slide"/g)?.length, 3);
  assert.doesNotMatch(html, /<script|javascript:/i);
  assert.match(openUiChartPrompt, /Gallery\(title: string, slides:/);
});

test("rejects unsafe or oversized galleries", () => {
  for (const items of [
    [{ image: "javascript:alert(1)", title: "x" }],
    [{ image: "data:image/png;base64,AA", title: "x" }],
    [{ image: "/a.png", title: "x", link: "javascript:x" }],
    [],
    Array(25).fill(slides[0]),
  ])
    assert.equal(inspectOpenUiChart(board(items)).kind, "invalid", JSON.stringify(items).slice(0, 60));
});
