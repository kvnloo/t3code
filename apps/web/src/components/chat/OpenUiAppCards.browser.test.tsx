import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { APP_CARDS_BOARD as BOARD } from "../../../test/fixtures/appCardsBoard";
import { setAppearanceMode } from "~/hooks/useTheme";
import { render } from "../../../test/render";
import { OpenUiCharts } from "./OpenUiCharts";

// The real Ferry Building to SFO driving route (OSRM over OpenStreetMap), as a maps tool returns it.

const shot = import.meta.env.VITE_APP_CARDS_SHOT;
// Entry transitions and the basemap finish before a screenshot.
const settle = async () => {
  await Promise.all(document.getAnimations().map((animation) => animation.finished));
  await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)));
};

describe("OpenUI app cards", () => {
  it("renders every card and keeps taps local to the card", async () => {
    await render(
      <div className="w-[640px] bg-background p-4">
        <OpenUiCharts code={BOARD} />
      </div>,
    );

    await expect.element(page.getByText("INV-2041.pdf", { exact: false })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: /^Dana Ruiz/ }));
    await expect
      .element(page.getByRole("button", { name: /^Dana Ruiz/ }))
      .toHaveAttribute("aria-expanded", "true");

    await expect.element(page.getByRole("link", { name: "Choose UberX" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: /^Comfort/ }));
    await expect.element(page.getByRole("link", { name: "Choose Comfort" })).toBeVisible();

    const map = page.getByRole("region", { name: /^Directions from Ferry Building/ });
    // The route is drawn from the tool's geometry: one point per coordinate it returned.
    const routePath = map
      .element()
      .querySelector('svg[viewBox="0 0 400 200"] path')!
      .getAttribute("d")!;
    expect(routePath.split("L")).toHaveLength(36);
    await expect.element(page.getByText("22 min")).toBeVisible();
    await expect.element(page.getByText(/via I-280 S and US-101 S/)).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Next step" }));
    await expect
      .element(page.getByRole("status").filter({ hasText: "Turn left onto Mission St" }))
      .toBeVisible();

    await expect.element(page.getByText("Rename picker tokens")).toBeVisible();
    await expect
      .element(page.getByText("This branch has 2 conflicts that must be resolved"))
      .toBeVisible();
    // The failing check opens with its log line.
    await expect
      .element(page.getByRole("status").filter({ hasText: "src/picker.ts:14 no-unused-vars" }))
      .toBeVisible();
    await expect.element(page.getByText("38s")).toBeVisible();

    if (shot) {
      await page.viewport(720, 2000);
      await settle();
      await page
        .getByRole("region", { name: "Your apps" })
        .screenshot({ path: "app-cards-light.png" });
    }
  });

  it("fits a phone-width thread without overflow", async () => {
    await page.viewport(390, 900);
    await render(
      <div className="w-[358px] bg-background p-2">
        <OpenUiCharts code={BOARD} />
      </div>,
    );
    await expect.element(page.getByRole("link", { name: "Choose UberX" })).toBeVisible();
    for (const card of document.querySelectorAll<HTMLElement>("[data-app-card]")) {
      expect(card.scrollWidth, card.dataset.appCard).toBeLessThanOrEqual(card.clientWidth + 1);
    }
    if (shot) {
      await page.viewport(390, 2400);
      await settle();
      await page
        .getByRole("region", { name: "Your apps" })
        .last()
        .screenshot({ path: "app-cards-phone.png" });
    }
  });

  it("switches each card to its app's dark theme", async () => {
    setAppearanceMode("dark");
    try {
      await page.viewport(720, 900);
      await render(
        <div className="dark w-[640px] bg-background p-4">
          <OpenUiCharts code={BOARD} />
        </div>,
      );
      const pr = page.getByRole("region", { name: "Pull request 128, conflict" }).last();
      // Primer dark canvas.
      await expect.element(pr).toHaveStyle({ backgroundColor: "rgb(13, 17, 23)" });
      if (shot) {
        await page.viewport(720, 2000);
        await settle();
        await page
          .getByRole("region", { name: "Your apps" })
          .last()
          .screenshot({ path: "app-cards-dark.png" });
      }
    } finally {
      setAppearanceMode("light");
    }
  });

  it("fills a streaming board in card by card", async () => {
    const lines = BOARD.split("\n");
    // Root, mail and half of the ride statement have arrived.
    const partial = `${lines.slice(0, 2).join("\n")}\n${lines[2]!.slice(0, 40)}`;
    const screen = await render(
      <div className="w-[640px] bg-background p-4">
        <OpenUiCharts code={partial} isStreaming />
      </div>,
    );
    await expect.element(screen.getByText("INV-2041.pdf", { exact: false })).toBeVisible();
    expect(screen.container.querySelectorAll("[data-app-card]")).toHaveLength(1);
    await screen.rerender(
      <div className="w-[640px] bg-background p-4">
        <OpenUiCharts code={BOARD} />
      </div>,
    );
    await vi.waitFor(() =>
      expect(screen.container.querySelectorAll("[data-app-card]")).toHaveLength(4),
    );
  });
});
