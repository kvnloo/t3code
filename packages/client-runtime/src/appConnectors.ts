/**
 * Brands for connector tools: activity rows read "Searching Gmail · invoices" with the app's color,
 * matched by MCP server name so every provider gets it. The OpenUI app cards share these brands.
 * Names and colors only identify the service; no logos are bundled (cards draw a monogram).
 */

export type AppBrandId =
  | "gmail"
  | "google-calendar"
  | "google-maps"
  | "uber"
  | "lyft"
  | "github"
  | "slack"
  | "spotify"
  | "doordash";

export interface AppBrand {
  readonly id: AppBrandId;
  readonly name: string;
  /** Monogram drawn in place of a logo. */
  readonly mark: string;
  /** Card accent: stripe, monogram background, primary button. */
  readonly color: string;
  /** Text and icon color drawn on `color`. */
  readonly onColor: string;
}

export const APP_BRANDS: Readonly<Record<AppBrandId, AppBrand>> = {
  gmail: { id: "gmail", name: "Gmail", mark: "M", color: "#EA4335", onColor: "#FFFFFF" },
  "google-calendar": {
    id: "google-calendar",
    name: "Google Calendar",
    mark: "31",
    color: "#1A73E8",
    onColor: "#FFFFFF",
  },
  "google-maps": {
    id: "google-maps",
    name: "Google Maps",
    mark: "◆",
    color: "#188038",
    onColor: "#FFFFFF",
  },
  uber: { id: "uber", name: "Uber", mark: "U", color: "#000000", onColor: "#FFFFFF" },
  lyft: { id: "lyft", name: "Lyft", mark: "L", color: "#FF00BF", onColor: "#FFFFFF" },
  github: { id: "github", name: "GitHub", mark: "GH", color: "#24292F", onColor: "#FFFFFF" },
  slack: { id: "slack", name: "Slack", mark: "#", color: "#4A154B", onColor: "#FFFFFF" },
  spotify: { id: "spotify", name: "Spotify", mark: "♪", color: "#1DB954", onColor: "#000000" },
  doordash: { id: "doordash", name: "DoorDash", mark: "D", color: "#FF3008", onColor: "#FFFFFF" },
};

/** Server-name aliases after normalization (lowercase, no separators). */
const SERVER_ALIASES: ReadonlyArray<readonly [AppBrandId, ReadonlyArray<string>]> = [
  ["gmail", ["gmail", "googlegmail", "gwsgmail", "googlemail"]],
  ["google-calendar", ["googlecalendar", "gcal", "calendar", "gwscalendar"]],
  ["google-maps", ["googlemaps", "maps", "gmaps"]],
  ["uber", ["uber", "uberrides"]],
  ["lyft", ["lyft"]],
  ["github", ["github", "gh"]],
  ["slack", ["slack"]],
  ["spotify", ["spotify"]],
  ["doordash", ["doordash"]],
];

/**
 * Normalize an MCP server name, undoing harness renames: Hermes registers editor-supplied
 * servers as `editor_<name>_<8 hex>`, and ACP titles may carry an `mcp__` prefix.
 */
export function normalizeServerName(server: string): string {
  return server
    .replace(/^mcp__/, "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/^editor_(.+?)_[0-9a-f]{8}$/, "$1")
    .replace(/[^a-z0-9]/g, "");
}

export function brandForServer(server: string): AppBrand | null {
  const key = normalizeServerName(server);
  for (const [id, aliases] of SERVER_ALIASES) if (aliases.includes(key)) return APP_BRANDS[id];
  return null;
}

/** Split a T3 tool name (`server.tool`) or an ACP title (`mcp__server__tool`). */
export function splitToolName(
  toolName: string,
): { readonly server: string; readonly tool: string } | null {
  const acp = /^mcp__(.+?)__(.+)$/.exec(toolName);
  if (acp) return { server: acp[1]!, tool: acp[2]! };
  const dot = toolName.indexOf(".");
  return dot > 0 && dot < toolName.length - 1
    ? { server: toolName.slice(0, dot), tool: toolName.slice(dot + 1) }
    : null;
}

export type AppActivityPhase = "running" | "done" | "failed";

export interface AppActivity {
  readonly brand: AppBrand;
  /** Sentence-case action, tense matched to the phase: "Searching Gmail" / "Searched Gmail". */
  readonly label: string;
  /** The most useful argument, e.g. the search query or the destination. */
  readonly detail: string | null;
  readonly phase: AppActivityPhase;
  /** A finished merge: clients play the one-shot merged transition. */
  readonly merged: boolean;
}

type Verb = readonly [pattern: RegExp, running: string, done: string];

/** First match wins; `{app}` is the brand name. */
const VERBS: ReadonlyArray<Verb> = [
  [/merge/, "Merging the pull request", "Merged the pull request"],
  [/(estimate|price|quote|fare)/, "Checking {app} prices", "Checked {app} prices"],
  [
    /(request|book|order|reserve)_?ride|^ride_request|request_?trip/,
    "Requesting an {app}",
    "Requested an {app}",
  ],
  [/(order|checkout|place_order)/, "Placing an order on {app}", "Placed an order on {app}"],
  [/(status|track|eta)/, "Checking the {app} status", "Checked the {app} status"],
  [/(direction|route|navigate|travel_?time)/, "Getting directions", "Got directions"],
  [/(send|reply|draft|compose)/, "Writing in {app}", "Wrote in {app}"],
  [/(create|add|schedule|insert)_?(event|meeting)/, "Adding to {app}", "Added to {app}"],
  [/(search|find|query|list|lookup|places)/, "Searching {app}", "Searched {app}"],
  [/(read|get|fetch|open|view)/, "Reading from {app}", "Read from {app}"],
  [/(play|queue)/, "Playing on {app}", "Played on {app}"],
];

const DETAIL_KEYS = [
  "query",
  "q",
  "search",
  "destination",
  "dropoff",
  "to",
  "title",
  "subject",
  "text",
  "address",
  "name",
];

function detailFrom(input: unknown): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  for (const key of DETAIL_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 120);
  }
  const number = record.number ?? record.pull_number ?? record.pr;
  return typeof number === "number" && Number.isSafeInteger(number) ? `#${number}` : null;
}

/**
 * Presentation for one tool call, or null when the server is not a known brand.
 * `status` takes T3 tool lifecycle values (`inProgress`, `completed`, `failed`, ...).
 */
export function resolveAppActivity(
  toolName: string | undefined,
  input: unknown,
  status: string | undefined,
): AppActivity | null {
  if (!toolName) return null;
  const parts = splitToolName(toolName);
  const brand = parts ? brandForServer(parts.server) : null;
  if (!parts || !brand) return null;
  const phase: AppActivityPhase =
    status === "failed" || status === "declined"
      ? "failed"
      : status === "completed"
        ? "done"
        : "running";
  const tool = parts.tool.toLowerCase();
  const verb = VERBS.find(([pattern]) => pattern.test(tool));
  const [running, done] = verb ? [verb[1], verb[2]] : ["Using {app}", "Used {app}"];
  const named = (template: string) => template.split("{app}").join(brand.name);
  return {
    brand,
    label:
      phase === "failed"
        ? `${named(running)} didn't finish`
        : named(phase === "running" ? running : done),
    detail: detailFrom(input),
    phase,
    merged: phase === "done" && /merge/.test(tool),
  };
}
