// Shoots the app cards film in the real app (AppRoot on fakeEnvironment.ts) with demo data, one
// PNG per frame, every animation pinned to a virtual clock. Skipped unless asked for:
//   VITE_APP_CARDS_FILM=<dir inside the repo> vp test run --project renders test/appCardsFilm.renders.tsx
import { createMemoryHistory } from "@tanstack/react-router";
import type { RunId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { AppRoot } from "~/AppRoot";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { setAppearanceMode } from "~/hooks/useTheme";
import { getRouter } from "~/router";
import ferrySfoMap from "./fixtures/ferry-sfo-map.png";
import {
  ENVIRONMENT_ID,
  assistantItem,
  emitThreadEvent,
  emptyThread,
  installFakeEnvironment,
  isThreadSubscribed,
  runningRun,
  toolItem,
  userItem,
  type FakeDriver,
} from "./fakeEnvironment";
import { act, fakeTimers, render } from "./render";

vi.mock("../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("./fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});
vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

const OUT = import.meta.env.VITE_APP_CARDS_FILM as string | undefined;
const FPS = Number(import.meta.env.VITE_APP_CARDS_FILM_FPS ?? 60);
// Resumes a killed run: frames before this one are replayed but not saved again.
const FROM = Number(import.meta.env.VITE_APP_CARDS_FILM_FROM ?? 0);
// Laid out at 1280x720 and drawn at 1.5x: 1080p frames with laptop-sized type.
const WIDTH = 1280;
const HEIGHT = 720;
const ZOOM = 1.5;

const TRIP = emptyThread("thread-trip", "Thursday before SFO");
const THREADS = [
  TRIP,
  emptyThread("thread-picker", "Model picker presets"),
  emptyThread("thread-session", "Refresh sessions in auth middleware"),
  emptyThread("thread-flaky", "Fix flaky composer tests"),
  emptyThread("thread-ws", "Trim websocket snapshot size"),
];
installFakeEnvironment(THREADS, { projectTitle: "t3code", environmentLabel: "MacBook Pro" });
__setClientSettingsForTests({
  ...DEFAULT_CLIENT_SETTINGS,
  onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
});

const PROMPT =
  "Thursday I fly out of SFO. Find the Acme invoice I still owe, price a ride from the Ferry Building, show me the route, and tell me if PR #128 can merge before I leave.";

// The real Ferry Building to SFO driving route (OSRM over OpenStreetMap), as the demo maps
// connector returns it, with the basemap it sends.
const FERRY_SFO =
  "[[37.79376,-122.39407],[37.79324,-122.3934],[37.79251,-122.39433],[37.79246,-122.39228],[37.78788,-122.38787],[37.78263,-122.38804],[37.77976,-122.38962],[37.77737,-122.39212],[37.7759,-122.39525],[37.77356,-122.39816],[37.77129,-122.40078],[37.76716,-122.40196],[37.76224,-122.40219],[37.75564,-122.40312],[37.74932,-122.40347],[37.74476,-122.4039],[37.73961,-122.40442],[37.73529,-122.40594],[37.73186,-122.40592],[37.72818,-122.40382],[37.72402,-122.40047],[37.71913,-122.39819],[37.71246,-122.39591],[37.70594,-122.39391],[37.69766,-122.39276],[37.68965,-122.39327],[37.6828,-122.39578],[37.67455,-122.3984],[37.66447,-122.40065],[37.65586,-122.40054],[37.64764,-122.40214],[37.64144,-122.40354],[37.63487,-122.40011],[37.62957,-122.39552],[37.62291,-122.39129],[37.6165,-122.383]]";
const MAP = `{image: "${new URL(ferrySfoMap, location.href).href}", bounds: [37.597565, -122.664055, 37.810018, -122.127003]}`;

const PROGRAM = [
  'root = Board("Thursday, before SFO", "From Gmail, Uber, Google Maps and GitHub. Demo data.", [mail, ride, route, pr])',
  'mail = MailList("invoices from Acme", [{from: "Acme Billing", subject: "Invoice INV-2041 for October", snippet: "Your invoice of $4,280.00 is due Nov 15. Pay by card or ACH from the billing portal.", time: "Oct 31", unread: true, attachment: "INV-2041.pdf"}, {from: "Dana Ruiz", subject: "Re: Updated pricing for Q4", snippet: "Thanks for confirming. I have updated the order form.", time: "Oct 24", unread: false}])',
  'ride = RideOptions("uber", "Ferry Building", "SFO Terminal 2", [{name: "UberX", minutes: 4, price: "$38.40", seats: 4, arrival: "6:42 PM"}, {name: "Comfort", minutes: 6, price: "$46.10", seats: 4, arrival: "6:45 PM"}, {name: "UberXL", minutes: 9, price: "$61.75", seats: 6, arrival: "6:49 PM"}])',
  `route = Route("Ferry Building", "SFO Terminal 2", "drive", 22, "14.5 mi", ["Head south on Steuart St", "Turn left onto Mission St", "Turn right onto The Embarcadero", "Merge onto I-280 S", "Take US-101 S toward the airport", "Turn right onto Departures"], "I-280 S and US-101 S", ${FERRY_SFO}, ${MAP})`,
  'pr = PullRequest(128, "Add model picker presets", "conflict", "feat/model-picker", "main", [{name: "Install", status: "pass", detail: "", started: 0, seconds: 11}, {name: "Tests", status: "pass", detail: "412 passed", started: 11, seconds: 38}, {name: "Lint", status: "fail", detail: "src/picker.ts:14 \'preset\' is defined but never used", started: 11, seconds: 9}, {name: "Types", status: "running", detail: "", started: 20, seconds: 24}], 2, [{title: "Wire presets into the composer", sha: "a41f9c2", author: "kevin", age: "2h", lane: "head", branch: "feat/model-picker"}, {title: "Add preset tests", sha: "9b3e0d4", author: "kevin", age: "3h", lane: "head"}, {title: "Rename picker tokens", sha: "c90e1b7", author: "julius", age: "5h", lane: "base", branch: "main", conflict: true}, {title: "Bump effect", sha: "77d0aa1", author: "theo", age: "1d", lane: "base"}])',
].join("\n");
const INTRO = "Here's Thursday at a glance, from your connected apps.\n\n```openui-v2\n";
const OUTRO =
  "\n```\n\nThe Acme invoice is **$4,280, due Nov 15**. UberX is cheapest at $38.40 and the drive is 22 min via I-280. PR #128 can't merge yet: 2 conflicts with `main`, and Lint is failing.";
const ANSWER = INTRO + PROGRAM + OUTRO;

const TOOLS = [
  ["tool-gmail", "mcp__gmail__search_messages", { query: "invoices from Acme" }],
  [
    "tool-uber",
    "mcp__uber__get_price_estimates",
    { pickup: "Ferry Building", dropoff: "SFO Terminal 2" },
  ],
  [
    "tool-maps",
    "mcp__google-maps__get_directions",
    { origin: "Ferry Building", destination: "SFO Terminal 2", mode: "drive" },
  ],
  ["tool-github", "mcp__github__get_pull_request", { number: 128 }],
] as const;

const firstSeen = new WeakMap<Animation, number>();
/** Pauses every animation and transition and puts it where it would be at `t` seconds. */
function pinAnimations(t: number) {
  for (const animation of document.getAnimations()) {
    if (!firstSeen.has(animation)) firstSeen.set(animation, t);
    animation.pause();
    animation.currentTime = (t - firstSeen.get(animation)!) * 1000;
  }
}

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// A cursor drawn over the app, since Playwright's pointer is invisible in screenshots.
const cursor = document.createElement("div");
cursor.style.cssText =
  "position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);filter:drop-shadow(0 1px 2px rgb(0 0 0/.35))";
cursor.innerHTML =
  '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 2.5v17.2l4.6-4.4 3 6.6 2.9-1.3-3-6.5h6.4z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
let cursorAt: readonly [number, number] = [WIDTH * ZOOM * 0.62, HEIGHT * ZOOM * 0.9];

function centerOf(element: Element): readonly [number, number] {
  const box = element.getBoundingClientRect();
  return [box.left + box.width / 2, box.top + box.height / 2];
}

function scroller(): HTMLElement {
  const anchor =
    document.querySelector('[aria-label="Thursday, before SFO"]') ?? document.querySelector("main");
  let node = anchor?.parentElement ?? null;
  while (
    node &&
    !(
      node.scrollHeight > node.clientHeight + 4 &&
      /auto|scroll/.test(getComputedStyle(node).overflowY)
    )
  ) {
    node = node.parentElement;
  }
  if (!node) throw new Error("no thread scroller");
  return node;
}

it.skipIf(!OUT)(
  "app cards film",
  async () => {
    await page.viewport(WIDTH * ZOOM, HEIGHT * ZOOM);
    const start = new Date("2026-03-17T19:12:24.000Z").getTime();
    // Until connected, Date runs at real speed from just before the fixtures' timestamps, so the
    // minute clock behind sidebar ages ("2m") starts there and discovery's backoff still elapses.
    vi.useFakeTimers({ toFake: ["Date"], now: start - 90_000, shouldAdvanceTime: true });
    const router = getRouter(
      createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${TRIP.id}`] }),
    );
    console.log("film: loading router");
    // Discovery sometimes stalls the first load; AppRoot finishes it once mounted.
    await Promise.race([router.load(), new Promise((resolve) => setTimeout(resolve, 8000))]);
    console.log("film: router loaded");
    const container = document.createElement("div");
    container.style.cssText = `height: ${HEIGHT}px; width: ${WIDTH}px; zoom: ${ZOOM};`;
    // Full-height views size to the viewport, which is ZOOM times the laid-out height here.
    const fit = document.createElement("style");
    fit.textContent = `.h-dvh, .h-svh { height: ${HEIGHT}px !important; } @media (min-width: 768px) { .md\\:h-dvh { height: ${HEIGHT}px !important; } }`;
    document.head.append(fit);
    await using _app = await render(<AppRoot router={router} />, { container, router: false });
    document.body.append(cursor);
    await vi.waitFor(() => expect(isThreadSubscribed(TRIP.id)).toBe(true), { timeout: 30_000 });
    await document.fonts.ready;
    // From here Date only moves with the virtual clock. It starts just before the fixture runs'
    // timestamps, so "Working for" counts from zero.
    vi.useRealTimers();
    using _clock = fakeTimers({ toFake: ["Date"], now: start });
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const run = runningRun(TRIP.id, "trip-run", 1, "trip-user");
    const runId = run.id as RunId;
    const editor = page.getByTestId("composer-editor");
    let frame = 0;
    let typed = 0;
    let streamed = 0;
    const toolsStarted = new Set<string>();
    const toolsDone = new Set<string>();
    let sent = false;
    let finished = false;
    let scrollFrom: number | null = null;
    const done = new Set<string>();
    const once = async (key: string, at: number, t: number, action: () => Promise<void>) => {
      if (t >= at && !done.has(key)) {
        done.add(key);
        await action();
      }
    };
    const emit = (event: Parameters<typeof emitThreadEvent>[1]) =>
      act(() => emitThreadEvent(TRIP.id as ThreadId, event));

    /** Glides the cursor to `target` over [from, to] seconds. */
    const glide = (
      t: number,
      from: number,
      to: number,
      start: readonly [number, number],
      target: readonly [number, number],
    ) => {
      if (t < from || t > to + 1 / FPS) return;
      const k = ease(clamp01((t - from) / (to - from)));
      cursorAt = [start[0] + (target[0] - start[0]) * k, start[1] + (target[1] - start[1]) * k];
    };
    const targets = new Map<string, readonly [number, number]>();
    const aim = (key: string, find: () => Element | null) => {
      if (!targets.has(key)) {
        const element = find();
        if (element) targets.set(key, centerOf(element));
      }
      return targets.get(key);
    };
    const scrollTo = (t: number, from: number, to: number, target: () => number) => {
      if (t < from || t > to + 1 / FPS) return;
      const node = scroller();
      if (scrollFrom === null || t - from < 1 / FPS / 2) scrollFrom = node.scrollTop;
      node.scrollTop =
        scrollFrom + (target() - scrollFrom) * ease(clamp01((t - from) / (to - from)));
      if (t >= to) scrollFrom = null;
    };
    const cardTop = (label: RegExp) => {
      const node = scroller();
      const card = [...document.querySelectorAll("[data-app-card]")].find((element) =>
        label.test(element.getAttribute("aria-label") ?? ""),
      );
      if (!card) return node.scrollTop;
      return (
        node.scrollTop +
        (card.getBoundingClientRect().top - node.getBoundingClientRect().top) / ZOOM -
        24
      );
    };

    const DURATION = 46;
    for (let t = 0; t <= DURATION; t += 1 / FPS, frame++) {
      vi.setSystemTime(start + t * 1000);
      // 0.6-4.6 s: type the prompt into the real composer.
      await once("focus", 0.3, t, () => userEvent.click(editor));
      if (t >= 0.6 && t < 4.6) {
        const want = Math.round(PROMPT.length * ease(clamp01((t - 0.6) / 3.8)));
        if (want > typed) {
          await userEvent.keyboard(PROMPT.slice(typed, want).replace(/[{[]/g, (c) => c + c));
          typed = want;
        }
      }
      glide(
        t,
        4.6,
        5.2,
        cursorAt,
        aim("send", () =>
          document.querySelector('button[aria-label^="Send"], button[type="submit"]'),
        ) ?? cursorAt,
      );
      // 5.3 s: send. The fake server never answers a send, so the composer is cleared by hand
      // and the turn arrives as the server would deliver it.
      if (t >= 5.3 && !sent) {
        sent = true;
        await userEvent.keyboard("{Control>}a{/Control}{Backspace}");
        await emit({ type: "run.created", payload: run });
        await emit({
          type: "turn-item.updated",
          payload: userItem(TRIP.id, runId, "trip-user", 0, PROMPT),
        });
      }
      // 6.0-9.6 s: four connector calls, overlapping.
      for (const [index, [id, name, input]] of TOOLS.entries()) {
        const start = 6.0 + index * 0.45;
        const end = start + 1.5 + index * 0.25;
        if (t >= start && !toolsStarted.has(id)) {
          toolsStarted.add(id);
          await emit({
            type: "turn-item.updated",
            payload: toolItem(TRIP.id, runId, id, 1 + index, name, input, true),
          });
        }
        if (t >= end && !toolsDone.has(id)) {
          toolsDone.add(id);
          await emit({
            type: "turn-item.updated",
            payload: toolItem(TRIP.id, runId, id, 1 + index, name, input, false),
          });
        }
      }
      // 10-19 s: the answer streams; the board fills in card by card.
      if (t >= 10 && streamed < ANSWER.length) {
        const want = Math.min(ANSWER.length, Math.round((t - 10) * 520));
        if (want > streamed) {
          streamed = want;
          await emit({
            type: "turn-item.updated",
            payload: assistantItem(
              TRIP.id,
              runId,
              "trip-answer",
              5,
              ANSWER.slice(0, streamed),
              streamed < ANSWER.length,
            ),
          });
        }
      }
      if (streamed >= ANSWER.length && !finished) {
        finished = true;
        await emit({
          type: "run.updated",
          payload: { ...run, status: "completed", completedAt: run.startedAt },
        });
      }
      // 20-46 s: read the board, tapping as a person would.
      scrollTo(t, 19.6, 21.0, () => cardTop(/^Gmail results/));
      glide(
        t,
        21.2,
        22.0,
        cursorAt,
        aim(
          "mail",
          () => [...document.querySelectorAll("[data-app-card=gmail] button")].at(-1) ?? null,
        ) ?? cursorAt,
      );
      await once("mail", 22.1, t, () =>
        userEvent.click(page.getByRole("button", { name: /^Dana Ruiz/ })),
      );
      scrollTo(t, 23.2, 24.6, () => cardTop(/ride options/));
      glide(
        t,
        24.8,
        25.6,
        cursorAt,
        aim("comfort", () =>
          document.querySelector('[data-app-card=uber] button[aria-label^="Comfort"]'),
        ) ?? cursorAt,
      );
      await once("comfort", 25.7, t, () =>
        userEvent.click(page.getByRole("button", { name: /^Comfort/ })),
      );
      scrollTo(t, 27.0, 28.4, () => cardTop(/^Directions/));
      for (const [n, at] of [
        [0, 29.6],
        [1, 30.6],
        [2, 31.6],
      ] as const) {
        glide(
          t,
          at - 0.9,
          at - 0.1,
          cursorAt,
          aim("next", () => document.querySelector('[aria-label="Next step"]')) ?? cursorAt,
        );
        await once(`next${n}`, at, t, () =>
          userEvent.click(page.getByRole("button", { name: "Next step" })),
        );
      }
      scrollTo(t, 32.6, 34.0, () => cardTop(/^Pull request/));
      glide(
        t,
        34.2,
        35.0,
        cursorAt,
        aim(
          "tests",
          () =>
            [...document.querySelectorAll("[data-app-card=github] button")].find((b) =>
              b.textContent?.startsWith("Tests"),
            ) ?? null,
        ) ?? cursorAt,
      );
      await once("tests", 35.1, t, () =>
        userEvent.click(page.getByRole("button", { name: /^Tests/ })),
      );
      // 37.5 s: dark mode, the way Settings or the theme shortcut switches it.
      await once("dark", 37.5, t, async () => {
        await act(() => void setAppearanceMode("dark"));
      });
      scrollTo(t, 39.0, 41.5, () => cardTop(/^Gmail results/) - 40);
      scrollTo(t, 42.0, 45.0, () => cardTop(/^Pull request/));

      // Let React commit, then pin animations to this frame's time and save it.
      // Frames being replayed only need React to commit, not a paint.
      await new Promise((resolve) =>
        frame >= FROM ? requestAnimationFrame(() => resolve(null)) : setTimeout(resolve, 0),
      );
      cursor.style.transform = `translate(${cursorAt[0] - 3}px, ${cursorAt[1] - 2}px)`;
      pinAnimations(t);
      if (frame % 20 === 0) console.log(`film: frame ${frame} t=${t.toFixed(2)}`);
      if (frame >= FROM)
        await page.screenshot({ path: `${OUT}/${String(frame).padStart(5, "0")}.png`, save: true });
    }
    expect(finished).toBe(true);
    setAppearanceMode("light");
  },
  3_600_000,
);
