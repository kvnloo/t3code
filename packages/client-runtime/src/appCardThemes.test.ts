import * as NodeAssert from "node:assert/strict";
import { it as test } from "vite-plus/test";

import { appCardTheme, projectPath } from "./appCardThemes.ts";

test("each app gets its own design system in both schemes", () => {
  NodeAssert.equal(appCardTheme("github", "light").done, "#8250df");
  NodeAssert.equal(appCardTheme("github", "dark").surface, "#0d1117");
  NodeAssert.equal(appCardTheme("uber", "light").primary, "#000000");
  NodeAssert.equal(appCardTheme("gmail", "dark").font, "google-sans");
  NodeAssert.equal(appCardTheme("spotify", "light").font, "google-sans");
});

test("a route path keeps its shape and fits the box", () => {
  // A north-south route is taller than wide, so it fills the height and is centred horizontally.
  const { points, d } = projectPath(
    [
      [37.79, -122.39],
      [37.7, -122.4],
      [37.62, -122.38],
    ],
    300,
    200,
    20,
  );
  const ys = points.map(([, y]) => y);
  NodeAssert.equal(Math.min(...ys), 20);
  NodeAssert.equal(Math.max(...ys), 180);
  for (const [x] of points) NodeAssert.ok(x > 100 && x < 200);
  NodeAssert.match(d, /^M[\d.]+ [\d.]+ L/);
  NodeAssert.deepEqual(projectPath([], 10, 10).points, []);
});

test("with basemap bounds, a point lands where the image drew it", () => {
  // Bounds and pixel from the Ferry Building to SFO basemap the demo maps connector returns.
  const bounds = [37.597565, -122.664055, 37.810018, -122.127003] as const;
  const { points } = projectPath([[37.7944, -122.394]], 400, 200, 16, bounds);
  const [x, y] = points[0]!;
  NodeAssert.ok(Math.abs(x - 201.2) < 1, `x ${x}`);
  NodeAssert.ok(Math.abs(y - 14.7) < 1, `y ${y}`);
});
