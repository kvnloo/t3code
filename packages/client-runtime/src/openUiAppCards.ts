/**
 * App cards for the `openui-v2` catalog: rides, mail, routes and pull requests in their app's colors.
 * Read-only like the charts: taps stay local to the card and nothing is booked, sent or merged.
 * Design credits: docs/user/openui-reports.md.
 */
import { APP_BRANDS, type AppBrand } from "./appConnectors.ts";

export const APP_CARD_TYPES = ["RideOptions", "MailList", "Route", "PullRequest"] as const;
export type AppCardType = (typeof APP_CARD_TYPES)[number];

export const APP_CARD_LIMITS = {
  text: 200,
  snippet: 400,
  price: 24,
  rideOptions: 8,
  messages: 20,
  steps: 20,
  checks: 12,
  commits: 12,
  pathPoints: 600,
  url: 2_000,
  minutes: 100_000,
} as const;

export const APP_CARD_DESCRIPTIONS: Readonly<Record<AppCardType, string>> = {
  RideOptions:
    'Ride choices a ride app returned for one trip: app is "uber" or "lyft"; each option has a name, pickup minutes, a price string, seats and optionally an arrival time text.',
  MailList:
    "Messages a mail search returned: the query, then each message's sender, subject, snippet, time text, unread flag and optionally one attachment file name.",
  Route:
    "Directions a maps app returned: origin, destination, mode (drive, walk, transit or bike), minutes, a distance string, then the steps in order. Optionally the road it takes (via), the route geometry the tool returned as [lat, lon] points (path) and the static basemap it returned as {image, bounds: [south, west, north, east]} (map); never invent a path or a map.",
  PullRequest:
    "One pull request: number, title, state (open, conflict, ready, merged or closed), head and base branches, its checks (pass, fail, running or skip, optionally with the second each started and how many seconds it ran), the conflict count, and optionally its recent commits newest first (title, short sha, author, age text, lane base, head or side, an optional branch label on a lane's tip, and conflict true on base commits that conflict).",
};

export const APP_CARD_PROMPT_RULES = [
  "App cards only show what a connector tool returned in this turn. Copy values exactly; never invent prices, times, messages or check results.",
  "PullRequest state conflict needs a conflict count above 0; ready means every check passed or was skipped; merged and closed have no conflicts.",
] as const;

export const APP_CARD_EXAMPLE =
  'root = Board("Ride to SFO", "UberX is the cheapest option.", [rides])\nrides = RideOptions("uber", "Ferry Building", "SFO Terminal 2", [{name: "UberX", minutes: 4, price: "$31.20", seats: 4}, {name: "Comfort", minutes: 6, price: "$38.90", seats: 4}])';

export interface RideOption {
  readonly name: string;
  readonly minutes: number;
  readonly price: string;
  readonly seats: number;
}
export interface MailMessage {
  readonly from: string;
  readonly subject: string;
  readonly snippet: string;
  readonly time: string;
  readonly unread: boolean;
}
export type CheckStatus = "pass" | "fail" | "running" | "skip";
export interface PullRequestCheck {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
}
export type PullRequestState = "open" | "conflict" | "ready" | "merged" | "closed";

export type AppCardPanel =
  | {
      readonly typeName: "RideOptions";
      readonly props: {
        readonly app: "uber" | "lyft";
        readonly options: ReadonlyArray<RideOption>;
      };
    }
  | {
      readonly typeName: "MailList";
      readonly props: { readonly messages: ReadonlyArray<MailMessage> };
    }
  | { readonly typeName: "Route"; readonly props: { readonly steps: ReadonlyArray<string> } }
  | {
      readonly typeName: "PullRequest";
      readonly props: {
        readonly state: PullRequestState;
        readonly checks: ReadonlyArray<PullRequestCheck>;
        readonly conflicts: number;
      };
    };

export function isAppCardType(value: unknown): value is AppCardType {
  return typeof value === "string" && (APP_CARD_TYPES as ReadonlyArray<string>).includes(value);
}

/** Cross-field rules the schemas cannot express. */
export function appCardProblem(panel: AppCardPanel): string | null {
  switch (panel.typeName) {
    case "RideOptions": {
      const names = panel.props.options.map((option) => option.name);
      return new Set(names).size === names.length
        ? null
        : "RideOptions lists the same option twice.";
    }
    case "MailList":
    case "Route":
      return null;
    case "PullRequest": {
      const { state, checks, conflicts } = panel.props;
      if (state === "conflict" && conflicts < 1)
        return "PullRequest in conflict needs a conflict count.";
      if (state !== "conflict" && state !== "open" && conflicts > 0)
        return `PullRequest ${state} cannot have conflicts.`;
      if (
        state === "ready" &&
        checks.some((check) => check.status === "fail" || check.status === "running")
      )
        return "PullRequest ready needs every check passed or skipped.";
      return null;
    }
  }
}

export function rideBrand(app: "uber" | "lyft"): AppBrand {
  return APP_BRANDS[app];
}

export function rideReadout(option: RideOption) {
  return `${option.name} · pickup in ${option.minutes} min · ${option.price} · ${option.seats} seats`;
}

/** The cheapest option by the numeric part of its price, for the "Best price" tag. */
export function cheapestRide(options: ReadonlyArray<RideOption>): string | null {
  let best: { name: string; value: number } | null = null;
  for (const option of options) {
    const value = Number(option.price.replace(/[^0-9.]/g, ""));
    if (
      Number.isFinite(value) &&
      option.price.match(/[0-9]/) &&
      (best === null || value < best.value)
    )
      best = { name: option.name, value };
  }
  return best?.name ?? null;
}

export function checkCounts(checks: ReadonlyArray<PullRequestCheck>) {
  const counts = { pass: 0, fail: 0, running: 0, skip: 0 };
  for (const check of checks) counts[check.status] += 1;
  return counts;
}

/** x of a commit-graph lane, in px from the card's left edge. */
export function commitLaneX(lane: "base" | "head" | "side") {
  return lane === "head" ? 34 : lane === "side" ? 46 : 22;
}

const AVATAR_COLORS = [
  "#5b6cf0",
  "#0f9d73",
  "#e37400",
  "#c2410c",
  "#7c3aed",
  "#0284c7",
  "#be185d",
  "#4d7c0f",
];

/** A stable avatar color for a sender, so one sender keeps one color across cards. */
export function avatarColor(name: string) {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

export type CarClass = "x" | "comfort" | "xl" | "black";

/** Which vehicle glyph a ride option gets, from its product name. */
export function carClass(name: string): CarClass {
  const n = name.toLowerCase();
  if (/\b(xl|xxl|suv|van|6|7)\b|xl$/.test(n)) return "xl";
  if (/black|lux|premier|select/.test(n)) return "black";
  if (/comfort|priority|extra/.test(n)) return "comfort";
  return "x";
}

export interface CheckSpan {
  readonly start: number;
  readonly length: number;
}

/**
 * Gantt bars for checks that report timing: each bar's start and length as fractions of the run.
 * Returns null when any check lacks timing, so the card falls back to chips.
 */
export function checkTimeline(
  checks: ReadonlyArray<{
    readonly started?: number | undefined;
    readonly seconds?: number | undefined;
  }>,
): { readonly total: number; readonly spans: ReadonlyArray<CheckSpan> } | null {
  if (
    checks.length === 0 ||
    checks.some((check) => check.started === undefined || check.seconds === undefined)
  )
    return null;
  const total = Math.max(1, ...checks.map((check) => check.started! + check.seconds!));
  return {
    total,
    spans: checks.map((check) => ({
      start: check.started! / total,
      length: check.seconds! / total,
    })),
  };
}

/** "1m 4s", "38s". */
export function formatSeconds(seconds: number) {
  const s = Math.round(seconds);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
