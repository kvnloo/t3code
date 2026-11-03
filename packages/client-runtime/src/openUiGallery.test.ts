import * as NodeAssert from "node:assert/strict";
import { it as test } from "vite-plus/test";

import { chartPanelProblem } from "./openUiCharts.ts";
import {
  GALLERY_ACCENTS,
  galleryAccent,
  galleryCounter,
  galleryGroups,
  galleryIndex,
  gallerySlideLabel,
  gallerySwipeTarget,
  isGalleryImageSource,
  type GallerySlide,
} from "./openUiGallery.ts";

const slides: GallerySlide[] = [
  { image: "/shots/terminal-1.jpg", title: "Terminal", caption: "Overview", group: "Terminal" },
  { image: "/shots/terminal-2.jpg", title: "Terminal", caption: "Amber theme", group: "Terminal" },
  { image: "shots/depth.jpg", title: "Depth" },
  { image: "https://example.com/kerosene.png", title: "Kerosene", group: "Kerosene" },
];

test("slides of one group share an accent, groups take accents in reading order", () => {
  const groups = galleryGroups(slides);
  NodeAssert.deepEqual(
    groups.map((group) => [group.key, group.first]),
    [
      ["Terminal", 0],
      ["Depth", 2],
      ["Kerosene", 3],
    ],
  );
  NodeAssert.equal(galleryAccent(slides, 0), GALLERY_ACCENTS[0]);
  NodeAssert.equal(galleryAccent(slides, 1), GALLERY_ACCENTS[0]);
  NodeAssert.equal(galleryAccent(slides, 2), GALLERY_ACCENTS[1]);
  NodeAssert.equal(galleryAccent(slides, 3), GALLERY_ACCENTS[2]);
});

test("navigation wraps and a swipe needs distance or speed", () => {
  NodeAssert.equal(galleryIndex(-1, 4), 3);
  NodeAssert.equal(galleryIndex(4, 4), 0);
  NodeAssert.equal(gallerySwipeTarget(0, 4, -50, 400), 0);
  NodeAssert.equal(gallerySwipeTarget(0, 4, -120, 400), 1);
  NodeAssert.equal(gallerySwipeTarget(0, 4, 120, 400), 3);
  NodeAssert.equal(gallerySwipeTarget(2, 4, -20, 400, -0.9), 3);
  NodeAssert.equal(galleryCounter(5, 4), "2 / 4");
  NodeAssert.equal(gallerySlideLabel(slides[1]!, 1, 4), "Terminal, Amber theme, 2 / 4");
});

test("image sources are paths or http(s), never other schemes", () => {
  NodeAssert.ok(isGalleryImageSource("/mnt/x/a.jpg"));
  NodeAssert.ok(isGalleryImageSource("docs/a.png"));
  NodeAssert.ok(isGalleryImageSource("C:\\shots\\a.png"));
  NodeAssert.ok(isGalleryImageSource("https://example.com/a.png"));
  NodeAssert.ok(!isGalleryImageSource("javascript:alert(1)"));
  NodeAssert.ok(!isGalleryImageSource("data:image/png;base64,AAAA"));
  NodeAssert.ok(!isGalleryImageSource(" "));
});

test("a board rejects unsafe slides with a reason", () => {
  NodeAssert.equal(chartPanelProblem({ typeName: "Gallery", props: { title: "Shots", slides } }), null);
  NodeAssert.match(
    chartPanelProblem({
      typeName: "Gallery",
      props: { title: "Shots", slides: [{ image: "data:image/png;base64,AA", title: "Bad" }] },
    }) ?? "",
    /needs a file path or an https image/,
  );
  NodeAssert.match(
    chartPanelProblem({
      typeName: "Gallery",
      props: { title: "Shots", slides: [{ image: "/a.png", title: "Bad link", link: "javascript:x" }] },
    }) ?? "",
    /link must be an http/,
  );
});
