import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  OpenUiCharts,
  inspectOpenUiChart,
  openUiChartPrompt,
} from "../../apps/web/src/components/chat/OpenUiCharts";

const render = (code: string) => renderToStaticMarkup(createElement(OpenUiCharts, { code }));

const ride = `root = Board("Ride to SFO", "UberX is the cheapest option.", [rides])
rides = RideOptions("uber", "Ferry Building", "SFO Terminal 2", [{name: "UberX", minutes: 4, price: "$31.20", seats: 4}, {name: "Comfort", minutes: 6, price: "$38.90", seats: 4}, {name: "UberXL", minutes: 9, price: "$52.10", seats: 6}])`;
const mail = `root = Board("Invoices", "Two unread invoices from Acme.", [mail])
mail = MailList("invoices from Acme", [{from: "Acme Billing", subject: "Invoice #4512", snippet: "Your October invoice is ready.", time: "9:41 AM", unread: true}, {from: "Acme Billing", subject: "Invoice #4498", snippet: "September invoice attached.", time: "Oct 2", unread: false}])`;
const route = `root = Board("To the Ferry Building", "About 18 minutes by car.", [route])
route = Route("Home", "Ferry Building", "drive", 18, "6.2 mi", ["Head north on Valencia St", "Turn right onto Market St", "Arrive at Ferry Building"])`;
const pr = (
  state: string,
  conflicts: number,
  checks = '[{name: "Tests", status: "pass", detail: "vitest · 42 passed"}, {name: "Lint", status: "pass", detail: ""}, {name: "Types", status: "pass", detail: ""}]',
) =>
  `root = Board("PR #128", "Status of the auth PR.", [pr])\npr = PullRequest(128, "Refresh sessions in the auth middleware", "${state}", "feat/session-refresh", "main", ${checks}, ${conflicts})`;

test("app cards parse, render their brand and supplied data", () => {
  const cases: Array<[string, RegExp[]]> = [
    [
      ride,
      [
        /Uber/,
        /#000000/,
        /Ferry Building → SFO Terminal 2/,
        /Best price/,
        /\$52\.10/,
        /Booking happens in the Uber app/,
      ],
    ],
    [
      mail,
      [
        /Gmail/,
        /#EA4335/,
        /“invoices from Acme” · 2 results · 1 unread/,
        /Invoice #4512/,
        /aria-label="Unread"/,
      ],
    ],
    [
      route,
      [
        /Google Maps/,
        /18 min/,
        /6\.2 mi/,
        /Driving · Home → Ferry Building/,
        /Turn right onto Market St/,
      ],
    ],
    [
      pr("ready", 0),
      [/GitHub/, /#128 · feat\/session-refresh → main/, /Ready to merge/, /Checks · 3 passed/],
    ],
    [pr("conflict", 3), [/3 conflicts with main/]],
    [pr("merged", 0), [/>Merged</, /#8250DF/]],
  ];
  for (const [code, patterns] of cases) {
    assert.deepEqual(inspectOpenUiChart(code), { kind: "ready" }, code.slice(0, 60));
    const html = render(code);
    for (const pattern of patterns) assert.match(html, pattern, `${code.slice(0, 40)} ${pattern}`);
    assert.doesNotMatch(html, /<script|javascript:|href=/i, "cards have no links or actions");
  }
  assert.equal(render(ride).match(/aria-pressed/g)?.length, 3);
  assert.match(openUiChartPrompt, /RideOptions\(app: "uber" \| "lyft"/);
  assert.match(openUiChartPrompt, /never invent prices/);
});

test("app cards reject incoherent states and unknown brands", () => {
  for (const code of [
    pr("conflict", 0),
    pr("merged", 2),
    pr("ready", 0, '[{name: "Tests", status: "running", detail: ""}]'),
    ride.replace('"uber"', '"bolt"'),
    ride.replace("[{name", '[{name: "UberX", minutes: 1, price: "$1", seats: 4}, {name'),
    route.replace('"drive"', '"teleport"'),
  ])
    assert.equal(inspectOpenUiChart(code).kind, "invalid", code.slice(-90));
});

test("app cards mix with charts on one board", () => {
  const code = `root = Board("Trip", "Ride and route.", [rides, route, spend])
rides = RideOptions("lyft", "Home", "Airport", [{name: "Lyft", minutes: 3, price: "$28", seats: 4}])
route = Route("Home", "Airport", "transit", 52, "14 mi", ["Walk to 16th St BART"])
spend = BarChart("Ride spend", "USD", [{label: "Uber", value: 120}, {label: "Lyft", value: 80}])`;
  assert.deepEqual(inspectOpenUiChart(code), { kind: "ready" });
  const html = render(code);
  assert.match(html, /#FF00BF/);
  assert.match(html, /Transit · Home → Airport/);
  assert.match(html, /Ride spend/);
});
