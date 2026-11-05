import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { OpenUiCharts, inspectOpenUiChart } from "./OpenUiCharts";
import { OpenUiImageSourceContext } from "./openUiImageSource";

// The production Gallery and parser, not a look-alike HTML page. Image URLs stay inside this test server.
const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480"><rect width="800" height="480" fill="#18181b"/><path d="M0 400 80 370 160 390 240 300 320 320 400 200 480 230 560 140 640 170 720 80 800 110" fill="none" stroke="#34d399" stroke-width="4"/></svg>');
const slides = [
  { image: "/shots/terminal.jpg", title: "Terminal", group: "Terminal", caption: "Overview", tags: [{ text: "Rust · egui", tone: "ok" }, { text: "no licence", tone: "bad" }], note: "First project", link: "https://github.com/michaelshimeles/terminal" },
  { image: "/shots/amber.jpg", title: "Terminal", group: "Terminal", caption: "Amber theme" },
  { image: "/shots/kerosene.jpg", title: "Kerosene", group: "Kerosene", caption: "Workspace", tags: [{ text: "MIT", tone: "ok" }], note: "Second project", link: "https://github.com/nilesjarvis/kerosene" },
];
const BOARD = `root = Board("Native picks", "From real repository screenshots.", [shots])\nshots = Gallery("Trading terminals", ${JSON.stringify(slides)})`;

describe("OpenUI Gallery", () => {
  it("accepts a Gallery fence and rejects unsafe image sources", () => {
    expect(inspectOpenUiChart(BOARD)).toEqual({ kind: "ready" });
    expect(inspectOpenUiChart(BOARD.replace("/shots/terminal.jpg", "javascript:alert(1)"))).toMatchObject({ kind: "invalid" });
  });

  it("navigates, groups, stars locally and opens full size", async () => {
    await render(
      <OpenUiImageSourceContext value={() => ({ kind: "url", url: svg })}>
        <div style={{ width: 390 }}>
          <OpenUiCharts code={BOARD} />
        </div>
      </OpenUiImageSourceContext>,
    );
    await expect.element(page.getByRole("region", { name: "Trading terminals" })).toBeVisible();
    await expect.element(page.getByText("1 / 3", { exact: true })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Next image", exact: true }));
    await expect.element(page.getByText("2 / 3", { exact: true })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Next image", exact: true }));
    await expect.element(page.getByText("Second project", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("link", { name: "Open", exact: true })).toHaveAttribute("href", "https://github.com/nilesjarvis/kerosene");
    await userEvent.click(page.getByRole("button", { name: "Star", exact: true }));
    await expect.element(page.getByRole("button", { name: "Starred", exact: true })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(page.getByRole("button", { name: "View full size", exact: true }));
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Close", exact: true }));
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "Next image", exact: true }));
    await expect.element(page.getByText("First project", { exact: true })).toBeVisible();
    const box = document.querySelector("[data-openui-gallery]")!.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(300);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });
});
