import * as NodeAssert from "node:assert/strict";
import { it as test } from "vite-plus/test";

import {
  brandForServer,
  normalizeServerName,
  resolveAppActivity,
  splitToolName,
} from "./appConnectors.ts";

test("server names resolve through harness renames", () => {
  NodeAssert.equal(normalizeServerName("editor_gmail_3f2a9c0d"), "gmail");
  NodeAssert.equal(normalizeServerName("mcp__google-maps"), "googlemaps");
  NodeAssert.equal(brandForServer("editor_google_maps_0a1b2c3d")?.id, "google-maps");
  NodeAssert.equal(brandForServer("Uber")?.name, "Uber");
  NodeAssert.equal(brandForServer("t3-code"), null);
  NodeAssert.equal(brandForServer("github_enterprise_tools"), null);
});

test("tool names split for T3 items and ACP titles", () => {
  NodeAssert.deepEqual(splitToolName("gmail.search_threads"), {
    server: "gmail",
    tool: "search_threads",
  });
  NodeAssert.deepEqual(splitToolName("mcp__editor_uber_0a1b2c3d__request_ride"), {
    server: "editor_uber_0a1b2c3d",
    tool: "request_ride",
  });
  NodeAssert.equal(splitToolName("terminal"), null);
});

test("activity wording follows the tool and its lifecycle", () => {
  const search = resolveAppActivity(
    "gmail.search_threads",
    { query: "invoices from Acme" },
    "inProgress",
  )!;
  NodeAssert.equal(search.label, "Searching Gmail");
  NodeAssert.equal(search.detail, "invoices from Acme");
  NodeAssert.equal(search.phase, "running");
  NodeAssert.equal(
    resolveAppActivity("gmail.search_threads", {}, "completed")!.label,
    "Searched Gmail",
  );
  NodeAssert.equal(
    resolveAppActivity("uber.estimate_rides", { dropoff: "SFO" }, "completed")!.label,
    "Checked Uber prices",
  );
  NodeAssert.equal(
    resolveAppActivity("editor_uber_0a1b2c3d.request_ride", { dropoff: "SFO" }, "inProgress")!
      .label,
    "Requesting an Uber",
  );
  NodeAssert.equal(
    resolveAppActivity("google_maps.directions", { destination: "Ferry Building" }, "completed")!
      .detail,
    "Ferry Building",
  );
  NodeAssert.equal(resolveAppActivity("lyft.unknown_tool", {}, "inProgress")!.label, "Using Lyft");
  NodeAssert.equal(
    resolveAppActivity("gmail.search_threads", {}, "failed")!.label,
    "Searching Gmail didn't finish",
  );
  NodeAssert.equal(resolveAppActivity("terminal", {}, "completed"), null);
  NodeAssert.equal(resolveAppActivity("t3-code.html_render", {}, "completed"), null);
});

test("only a finished merge plays the merged transition", () => {
  const merging = resolveAppActivity(
    "github.merge_pull_request",
    { pull_number: 128 },
    "inProgress",
  )!;
  NodeAssert.equal(merging.label, "Merging the pull request");
  NodeAssert.equal(merging.detail, "#128");
  NodeAssert.equal(merging.merged, false);
  NodeAssert.equal(
    resolveAppActivity("github.merge_pull_request", { pull_number: 128 }, "completed")!.merged,
    true,
  );
  NodeAssert.equal(resolveAppActivity("github.merge_pull_request", {}, "failed")!.merged, false);
  NodeAssert.equal(resolveAppActivity("github.search_issues", {}, "completed")!.merged, false);
});
