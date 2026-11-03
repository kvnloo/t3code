// App cards in other harnesses' tokens: each kit is mapped onto T3 Code's semantic variables around a
// real board; every card keeps its own app's design system. Skipped unless asked for:
//   VITE_HARNESS_KITS="$(cat kits.json)" VITE_HARNESS_OUT=<dir in repo> \
//     vp test run --project renders test/harnessKits.renders.tsx
import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { OpenUiCharts } from "~/components/chat/OpenUiCharts";
import { setAppearanceMode } from "~/hooks/useTheme";
import { APP_CARDS_BOARD } from "./fixtures/appCardsBoard";
import { act, render } from "./render";

interface Kit {
  readonly id: string;
  readonly name: string;
  readonly source: string;
  readonly fonts: { readonly ui?: string | null; readonly mono?: string | null };
  readonly radius: { readonly card?: string | null; readonly bubble?: string | null };
  readonly light: Record<string, string | null>;
  readonly dark: Record<string, string | null>;
}

const KITS: readonly Kit[] = JSON.parse(import.meta.env.VITE_HARNESS_KITS ?? "[]");
const OUT = import.meta.env.VITE_HARNESS_OUT;
const PROMPT =
  "Find the Acme invoice, price a ride from the Ferry Building to SFO, and check PR #128.";

// Kit role -> the T3 Code variables that draw that role.
const ROLE_VARS: Record<string, readonly string[]> = {
  canvas: ["--background"],
  surface: ["--card", "--popover", "--surface-raised"],
  text: ["--foreground", "--card-foreground", "--popover-foreground"],
  muted: ["--muted-foreground"],
  border: ["--border", "--input"],
  accent: ["--primary", "--ring"],
  userBubble: ["--message-surface"],
  userText: ["--message-foreground"],
  codeBg: ["--code-background"],
};

function kitStyle(kit: Kit, scheme: "light" | "dark") {
  const vars: Record<string, string> = {};
  for (const [role, names] of Object.entries(ROLE_VARS)) {
    const value = kit[scheme][role];
    if (value) for (const name of names) vars[name] = value;
  }
  if (kit.fonts.ui) vars["--font-sans"] = kit.fonts.ui;
  if (kit.fonts.mono) vars["--font-mono"] = kit.fonts.mono;
  if (kit.radius.card) vars["--radius"] = kit.radius.card;
  return vars;
}

function Shell(props: { kit: Kit; scheme: "light" | "dark"; width: number }) {
  const { kit, scheme, width } = props;
  return (
    <div
      data-harness={kit.id}
      className="flex flex-col gap-3 bg-background p-4 font-sans text-foreground"
      style={{ ...kitStyle(kit, scheme), width, fontFamily: "var(--font-sans)" }}
    >
      <div className="text-muted-foreground text-xs">
        {`${kit.name} tokens · ${scheme} · preview, not the real ${kit.name} UI`}
      </div>
      <div
        className="ml-auto max-w-[80%] bg-(--message-surface) px-3 py-2 text-(--message-foreground) text-sm"
        style={{ borderRadius: kit.radius.bubble ?? "1rem" }}
      >
        {PROMPT}
      </div>
      <div className="text-sm">Here's Thursday at a glance, from your connected apps.</div>
      <OpenUiCharts code={APP_CARDS_BOARD} />
    </div>
  );
}

const settle = async () => {
  await Promise.all(document.getAnimations().map((animation) => animation.finished));
  await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)));
};

it.skipIf(!OUT || KITS.length === 0)(
  "renders the app cards in every harness kit",
  async () => {
    for (const scheme of ["light", "dark"] as const) {
      await act(() => void setAppearanceMode(scheme));
      for (const width of [412, 760]) {
        await page.viewport(width + 40, 2600);
        for (const kit of KITS) {
          await using _shell = await render(<Shell kit={kit} scheme={scheme} width={width} />);
          await expect.element(page.getByText("INV-2041.pdf", { exact: false })).toBeVisible();
          await settle();
          const shell = document.querySelector(`[data-harness="${kit.id}"]`)!;
          // Nothing in a phone-width thread may scroll sideways.
          expect(shell.scrollWidth).toBeLessThanOrEqual(width + 1);
          await page
            .elementLocator(shell)
            .screenshot({ path: `${OUT}/${kit.id}-${scheme}-${width}.png`, save: true });
        }
      }
    }
    await act(() => void setAppearanceMode("light"));
  },
  600_000,
);
