/**
 * ephemeral-ui cards for the `openui-v2` catalog: the 50 card kinds of kvnloo/ephemeral-ui
 * (`schema/card.v0.json`), drawn by the kit's own code inside a sandboxed document with no network.
 * Web shows it in a sandboxed iframe, Android in a WebView. Taps stay inside the card: a card can
 * report what the reader pointed at, but it never sends, books, merges or approves anything.
 * Cards other than trace kinds draw the kit's sample data; trace kinds accept omp-stats JSON.
 */

/** card.v0.json `properties.kind.enum`, in order. A lab test keeps this equal to the generated kit. */
export const KIT_CARD_KINDS = [
  "inbox",
  "thread",
  "approve",
  "chat",
  "notify",
  "slots",
  "kanban",
  "triage",
  "file",
  "graph",
  "search",
  "feed",
  "frames",
  "sign",
  "context",
  "receipt",
  "metric",
  "track",
  "crm",
  "ride",
  "route",
  "boarding",
  "player",
  "workout",
  "home",
  "merge",
  "ci",
  "deploy",
  "incident",
  "migrate",
  "trace",
  "trace-span",
  "trace-summary",
  "trace-usage",
  "trace-tools",
  "trace-errors",
  "trace-compare",
  "trace-frustration",
  "intent-declare",
  "intent-contract",
  "intent-work",
  "intent-proof",
  "intel-decisions",
  "intel-value",
  "intel-context",
  "intel-health",
  "infra-architecture",
  "infra-cluster",
  "infra-iac",
  "infra-models",
] as const;
export type KitCardKind = (typeof KIT_CARD_KINDS)[number];

export const KIT_CARD_LIMITS = { cards: 12, title: 200, app: 60, inputBytes: 32_768 } as const;
export const KIT_CARD_OPTION_KEYS = ["range", "view", "sort", "tab", "focusTool", "scope"] as const;

export const KIT_CARDS_DESCRIPTION = `Cards from the ephemeral-ui kit, drawn by the kit itself: a title, then up to ${KIT_CARD_LIMITS.cards} cards in order. Each card has a kind (one of ${KIT_CARD_KINDS.join(", ")}) and optionally an app id (gmail, github, uber, stripe, google-calendar…; omit it for the kind's default app). Trace kinds may take input: omp-stats JSON for that kind, unchanged, and options {range, view, sort, tab, focusTool, scope}. Every other kind shows the kit's sample data, never the user's.`;

export const KIT_CARDS_PROMPT_RULE =
  "EphemeralCards show the ephemeral-ui kit's own cards with its sample data: use them when the user asks to see or try those cards, and say the data is sample data. Real data belongs in the other panels.";

export const KIT_CARDS_EXAMPLE =
  'root = Board("ephemeral-ui cards", "Three kit cards: mail, CI and a session trace. Sample data.", [kit])\nkit = EphemeralCards("Kit cards", [{kind: "inbox", app: "gmail"}, {kind: "ci", app: "github"}, {kind: "trace"}])';

export interface KitCard {
  readonly kind: KitCardKind;
  readonly app?: string | undefined;
  readonly input?: unknown;
  readonly options?: Readonly<Record<string, unknown>> | undefined;
}

export interface KitCardsPanel {
  readonly typeName: "EphemeralCards";
  readonly props: { readonly title: string; readonly cards: ReadonlyArray<KitCard> };
}

export const isTraceKind = (kind: string) => kind.startsWith("trace");

/** Cross-field rules the schemas cannot express. */
export function kitCardsProblem(panel: KitCardsPanel): string | null {
  for (const card of panel.props.cards) {
    if (card.input === undefined) continue;
    if (!isTraceKind(card.kind))
      return `EphemeralCards ${card.kind} draws sample data and takes no input.`;
    if (JSON.stringify(card.input).length > KIT_CARD_LIMITS.inputBytes)
      return `EphemeralCards ${card.kind} input exceeds ${KIT_CARD_LIMITS.inputBytes / 1024} KiB.`;
  }
  return null;
}

/** What a card reported back (the kit's `eui:intent`), reduced to text the host may show. */
export interface KitCardIntent {
  readonly kind: string;
  readonly action: string;
  readonly label: string;
  readonly ids: ReadonlyArray<string>;
}

export type KitCardMessage =
  | { readonly type: "height"; readonly value: number }
  | { readonly type: "intent"; readonly intent: KitCardIntent }
  | { readonly type: "error"; readonly kind: string; readonly reason: string };

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : "";

/** Parse a message posted by the kit document; anything else returns null. */
export function parseKitCardMessage(raw: unknown): KitCardMessage | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  if (message.source !== "t3-kit") return null;
  if (
    message.type === "height" &&
    typeof message.value === "number" &&
    Number.isFinite(message.value)
  ) {
    return { type: "height", value: Math.max(0, Math.min(20_000, Math.round(message.value))) };
  }
  if (message.type === "error")
    return { type: "error", kind: text(message.kind, 60), reason: text(message.reason, 300) };
  if (message.type === "intent" && typeof message.detail === "object" && message.detail !== null) {
    const detail = message.detail as Record<string, unknown>;
    const ids = Array.isArray(detail.ids)
      ? detail.ids
          .filter((id): id is string => typeof id === "string")
          .slice(0, 24)
          .map((id) => id.slice(0, 120))
      : [];
    return {
      type: "intent",
      intent: {
        kind: text(detail.kind, 60),
        action: text(detail.action, 60),
        label: text(detail.label, 200),
        ids,
      },
    };
  }
  return null;
}

/** One line under the cards: what the reader last pointed at, and that it stayed local. */
export function kitIntentReadout(intent: KitCardIntent | null): string {
  if (intent === null) return "Sample data from the ephemeral-ui kit. Taps stay in the card.";
  const what = intent.label || intent.action;
  return `${intent.kind} · ${what}${intent.ids.length ? ` · ${intent.ids.slice(0, 3).join(", ")}` : ""} · not sent`;
}
