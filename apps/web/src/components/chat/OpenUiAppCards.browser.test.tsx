import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { OpenUiCharts } from "./OpenUiCharts";

// One board with every app card, filled the way a connector turn would fill it.
const BOARD = [
  'root = Board("Your apps", "Demo data.", [mail, ride, route, pr])',
  'mail = MailList("invoices from Acme", [{from: "Acme Billing", subject: "Invoice INV-2041 for October", snippet: "Your invoice of $4,280.00 is due Nov 15.", time: "Oct 31", unread: true, attachment: "INV-2041.pdf"}, {from: "Dana Ruiz", subject: "Re: Updated pricing for Q4", snippet: "Thanks for confirming.", time: "Oct 24", unread: false}])',
  'ride = RideOptions("uber", "2240 Valencia St", "SFO", [{name: "UberX", minutes: 4, price: "$38.40", seats: 4, arrival: "6:42 PM"}, {name: "Comfort", minutes: 6, price: "$46.10", seats: 4}])',
  'route = Route("20th St", "SFO Terminal 2", "drive", 24, "14.2 mi", ["Head east on 20th St", "Turn right onto Valencia St", "Merge onto US-101 S"])',
  'pr = PullRequest(128, "Add model picker presets", "conflict", "feat/model-picker", "main", [{name: "Tests", status: "pass", detail: "412 passed"}, {name: "Lint", status: "running", detail: ""}], 2, [{title: "Wire presets into the composer", sha: "a41f9c2", author: "kevin", age: "2h", lane: "head", branch: "feat/model-picker"}, {title: "Rename picker tokens", sha: "c90e1b7", author: "julius", age: "5h", lane: "base", branch: "main", conflict: true}, {title: "Bump effect", sha: "77d0aa1", author: "theo", age: "1d", lane: "base"}])',
].join("\n");

describe("OpenUI app cards", () => {
  it("renders every card and keeps taps local to the card", async () => {
    await render(
      <div className="w-[640px] bg-background p-4">
        <OpenUiCharts code={BOARD} />
      </div>,
    );

    await expect.element(page.getByRole("button", { name: /PDF INV-2041\.pdf$/ })).toBeVisible();
    await expect.element(page.getByRole("link", { name: "Request UberX · $38.40" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: /^Comfort/ }));
    await expect
      .element(page.getByRole("link", { name: "Request Comfort · $46.10" }))
      .toBeVisible();

    await expect
      .element(page.getByRole("status").filter({ hasText: "Head east on 20th St" }))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Next step" }));
    await expect
      .element(page.getByRole("status").filter({ hasText: "Turn right onto Valencia St" }))
      .toBeVisible();

    await expect.element(page.getByText("Rename picker tokens")).toBeVisible();
    await expect.element(page.getByText("2 conflicts with main")).toBeVisible();
    if (import.meta.env.VITE_APP_CARDS_SHOT) {
      await page.viewport(720, 1500);
      await page.getByRole("region", { name: "Your apps" }).screenshot({ path: "app-cards.png" });
    }
  });
});
