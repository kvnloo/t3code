import * as NodeAssert from "node:assert/strict";
import { it as test } from "vite-plus/test";

import {
  appCardProblem,
  cheapestRide,
  checkCounts,
  pullRequestSteps,
  rideReadout,
  type PullRequestCheck,
} from "./openUiAppCards.ts";
import { chartPanelProblem } from "./openUiCharts.ts";

const options = [
  { name: "UberX", minutes: 4, price: "$31.20", seats: 4 },
  { name: "Comfort", minutes: 6, price: "$38.90", seats: 4 },
  { name: "UberXL", minutes: 9, price: "$52.10", seats: 6 },
];

test("ride options read out and tag the cheapest", () => {
  NodeAssert.equal(rideReadout(options[0]!), "UberX · pickup in 4 min · $31.20 · 4 seats");
  NodeAssert.equal(cheapestRide(options), "UberX");
  NodeAssert.equal(
    cheapestRide([{ name: "Wait & Save", minutes: 12, price: "Price on request", seats: 4 }]),
    null,
  );
  NodeAssert.match(
    appCardProblem({
      typeName: "RideOptions",
      props: { app: "uber", options: [...options, options[0]!] },
    })!,
    /same option twice/,
  );
});

test("pull request states must agree with checks and conflicts", () => {
  const checks: ReadonlyArray<PullRequestCheck> = [
    { name: "Tests", status: "pass", detail: "42 passed" },
    { name: "Lint", status: "pass", detail: "" },
  ];
  const pr = (
    state: "open" | "conflict" | "ready" | "merged" | "closed",
    conflicts: number,
    list = checks,
  ) => ({ typeName: "PullRequest" as const, props: { state, checks: list, conflicts } });
  NodeAssert.equal(appCardProblem(pr("ready", 0)), null);
  NodeAssert.equal(appCardProblem(pr("conflict", 3)), null);
  NodeAssert.match(appCardProblem(pr("conflict", 0))!, /conflict count/);
  NodeAssert.match(appCardProblem(pr("merged", 2))!, /cannot have conflicts/);
  NodeAssert.match(
    appCardProblem(pr("ready", 0, [{ name: "Tests", status: "running", detail: "" }]))!,
    /every check/,
  );
  NodeAssert.equal(
    chartPanelProblem(pr("merged", 0)),
    null,
    "the chart board inspector delegates to app cards",
  );
  NodeAssert.deepEqual(checkCounts([...checks, { name: "Types", status: "fail", detail: "" }]), {
    pass: 2,
    fail: 1,
    running: 0,
    skip: 0,
  });
  NodeAssert.deepEqual(
    pullRequestSteps("ready").map((step) => step.reached),
    [true, true, true, false],
  );
  NodeAssert.deepEqual(
    pullRequestSteps("merged").map((step) => step.reached),
    [true, true, true, true],
  );
});
