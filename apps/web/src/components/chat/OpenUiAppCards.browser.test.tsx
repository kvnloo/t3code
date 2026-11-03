import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import ferrySfoMap from "../../../test/fixtures/ferry-sfo-map.png";
import { setAppearanceMode } from "~/hooks/useTheme";
import { render } from "../../../test/render";
import { OpenUiCharts } from "./OpenUiCharts";

// The real Ferry Building to SFO driving route (OSRM over OpenStreetMap), as a maps tool returns it.
const FERRY_SFO = JSON.stringify([
  [37.79384, -122.39395],
  [37.79325, -122.39321],
  [37.79372, -122.39261],
  [37.79271, -122.39147],
  [37.79115, -122.39061],
  [37.78924, -122.38841],
  [37.78778, -122.38799],
  [37.78085, -122.38865],
  [37.7737, -122.39757],
  [37.77275, -122.3981],
  [37.76886, -122.39738],
  [37.76591, -122.39412],
  [37.76399, -122.393],
  [37.75164, -122.39166],
  [37.74557, -122.39467],
  [37.73888, -122.40064],
  [37.73572, -122.40444],
  [37.73383, -122.40507],
  [37.71634, -122.39893],
  [37.7114, -122.39581],
  [37.67773, -122.38851],
  [37.6742, -122.38972],
  [37.67028, -122.39245],
  [37.66498, -122.39762],
  [37.6597, -122.40477],
  [37.65578, -122.4068],
  [37.65292, -122.40712],
  [37.64071, -122.40597],
  [37.6356, -122.40409],
  [37.62656, -122.40252],
  [37.61442, -122.39796],
  [37.6138, -122.39644],
  [37.61536, -122.38856],
  [37.61475, -122.38581],
  [37.6151, -122.38486],
  [37.6165, -122.38392],
]);

// One board with every app card, filled the way a connector turn would fill it.
const BOARD = [
  'root = Board("Your apps", "Demo data.", [mail, ride, route, pr])',
  'mail = MailList("invoices from Acme", [{from: "Acme Billing", subject: "Invoice INV-2041 for October", snippet: "Your invoice of $4,280.00 is due Nov 15.", time: "Oct 31", unread: true, attachment: "INV-2041.pdf"}, {from: "Dana Ruiz", subject: "Re: Updated pricing for Q4", snippet: "Thanks for confirming.", time: "Oct 24", unread: false}])',
  'ride = RideOptions("uber", "Ferry Building", "SFO", [{name: "UberX", minutes: 4, price: "$38.40", seats: 4, arrival: "6:42 PM"}, {name: "Comfort", minutes: 6, price: "$46.10", seats: 4}, {name: "UberXL", minutes: 9, price: "$61.75", seats: 6}])',
  `route = Route("Ferry Building", "SFO Terminal 2", "drive", 22, "14.5 mi", ["Head south on Steuart St", "Turn left onto Mission St", "Turn right onto The Embarcadero"], "I-280 S and US-101 S", ${FERRY_SFO}, {image: "${new URL(ferrySfoMap, location.href).href}", bounds: [37.597565, -122.664055, 37.810018, -122.127003]})`,
  'pr = PullRequest(128, "Add model picker presets", "conflict", "feat/model-picker", "main", [{name: "Tests", status: "pass", detail: "412 passed", started: 11, seconds: 38}, {name: "Lint", status: "fail", detail: "src/picker.ts:14 no-unused-vars", started: 11, seconds: 9}, {name: "Types", status: "running", detail: "", started: 20, seconds: 24}], 2, [{title: "Wire presets into the composer", sha: "a41f9c2", author: "kevin", age: "2h", lane: "head", branch: "feat/model-picker"}, {title: "Rename picker tokens", sha: "c90e1b7", author: "julius", age: "5h", lane: "base", branch: "main", conflict: true}, {title: "Bump effect", sha: "77d0aa1", author: "theo", age: "1d", lane: "base"}])',
].join("\n");

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
});
