import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  OpenUiCharts,
  inspectOpenUiChart,
  openUiChartPrompt,
} from "../../apps/web/src/components/chat/OpenUiCharts";
import {
  EPHEMERAL_UI_KIT_KINDS,
  EPHEMERAL_UI_KIT_REVISION,
} from "../../packages/client-runtime/src/ephemeralUiKitDocument.generated.ts";
import { kitCardsDocument } from "../../packages/client-runtime/src/openUiKitCardDocument.ts";
import {
  KIT_CARD_KINDS,
  kitIntentReadout,
  parseKitCardMessage,
} from "../../packages/client-runtime/src/openUiKitCards.ts";

const board = (cards: unknown) =>
  `root = Board("Kit", "Sample data.", [kit])\nkit = EphemeralCards("Kit cards", ${JSON.stringify(cards)})`;

test("the catalog lists exactly the generated kit's 50 card.v0 kinds", () => {
  assert.equal(KIT_CARD_KINDS.length, 50);
  assert.deepEqual([...KIT_CARD_KINDS], [...EPHEMERAL_UI_KIT_KINDS]);
  assert.match(EPHEMERAL_UI_KIT_REVISION, /^[0-9a-f]{40}$/);
});

test("every kind parses through the stock parser, twelve cards to a panel", () => {
  for (let start = 0; start < KIT_CARD_KINDS.length; start += 12) {
    const cards = KIT_CARD_KINDS.slice(start, start + 12).map((kind) => ({ kind }));
    assert.deepEqual(
      inspectOpenUiChart(board(cards)),
      { kind: "ready" },
      cards.map((card) => card.kind).join(),
    );
  }
  assert.deepEqual(
    inspectOpenUiChart(
      board([
        { kind: "inbox", app: "gmail" },
        { kind: "trace-usage", options: { range: "7d" } },
      ]),
    ),
    { kind: "ready" },
  );
  const html = renderToStaticMarkup(
    createElement(OpenUiCharts, { code: board([{ kind: "inbox", app: "gmail" }]) }),
  );
  assert.match(html, /data-openui-kit-cards/);
  assert.match(html, /Kit cards/);
  assert.match(html, /Sample data from the ephemeral-ui kit/);
  assert.match(openUiChartPrompt, /EphemeralCards\(title: string, cards:/);
});

test("rejects unknown kinds, too many cards, input on sample kinds and unsafe app ids", () => {
  for (const cards of [
    [{ kind: "sculpt" }],
    [],
    Array(13).fill({ kind: "inbox" }),
    [{ kind: "inbox", input: { rows: [] } }],
    [{ kind: "inbox", app: "javascript:alert(1)" }],
    [{ kind: "inbox", app: "Gmail Inc" }],
  ])
    assert.equal(
      inspectOpenUiChart(board(cards)).kind,
      "invalid",
      JSON.stringify(cards).slice(0, 60),
    );
});

test("the document is offline and its card list cannot close the script element", () => {
  const html = kitCardsDocument(
    [{ kind: "trace", input: { title: "</script><script>alert(1)</script>" } }],
    "dark",
  );
  assert.doesNotMatch(html, /<\/script><script>alert/);
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/);
  assert.match(html, /"scheme":"dark"/);
});

test("only kit messages are read, and the readout says nothing was sent", () => {
  assert.equal(parseKitCardMessage("not json"), null);
  assert.equal(parseKitCardMessage({ type: "height", value: 10 }), null);
  assert.deepEqual(
    parseKitCardMessage(JSON.stringify({ source: "t3-kit", type: "height", value: 99999 })),
    { type: "height", value: 20000 },
  );
  const intent = parseKitCardMessage({
    source: "t3-kit",
    type: "intent",
    detail: {
      kind: "inbox",
      action: "select",
      label: "Open Invoice #4471",
      ids: ["message:m4471", 7],
    },
  });
  assert.deepEqual(intent, {
    type: "intent",
    intent: {
      kind: "inbox",
      action: "select",
      label: "Open Invoice #4471",
      ids: ["message:m4471"],
    },
  });
  assert.equal(
    kitIntentReadout(intent?.type === "intent" ? intent.intent : null),
    "inbox · Open Invoice #4471 · message:m4471 · not sent",
  );
});

test("replays the block a real Claude turn emitted for an ordinary request", () => {
  // Reply to "Show me the ephemeral-ui cards for an email inbox, a CI run, a ride and a session trace."
  const code =
    'root = Board("Ephemeral UI cards", "An email inbox, a CI run, a ride and a session trace, as the ephemeral-ui kit shows them.", [a])\na = EphemeralCards("Inbox, CI, ride and trace", [{kind: "inbox", app: "gmail"}, {kind: "ci", app: "github"}, {kind: "ride"}, {kind: "trace"}])';
  assert.deepEqual(inspectOpenUiChart(code), { kind: "ready" });
  const html = renderToStaticMarkup(createElement(OpenUiCharts, { code }));
  assert.match(html, /data-openui-kit-cards/);
  assert.match(html, /Inbox, CI, ride and trace/);
});
