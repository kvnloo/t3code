// Boot for one sandboxed ephemeral-ui card document (bundled by build-kit-document.mjs).
// Imports resolve against a kvnloo/ephemeral-ui checkout; the kit's own make() draws every card.
// Host contract: window.__T3_KIT_CARDS = { scheme: "light" | "dark", cards: [{ kind, app?, input?, options? }] }.
// The document posts { source: "t3-kit", type: "height" | "intent" | "error", ... } to the host.
import { rng, Run, quiet } from "./js/motion.js";
import { loadThemes, state, apply } from "./js/themes.js";
import { loadApps, catalog } from "./js/shell.js";
import { intentReady } from "./js/intent-data.js";
import { KINDS_A } from "./js/kinds-a.js";
import { KINDS_B } from "./js/kinds-b.js";
import { KINDS_T } from "./js/kinds-t.js";
import { KINDS_I } from "./js/kinds-i.js";
import { KINDS_INFRA } from "./js/kinds-infra.js";

const KINDS = { ...KINDS_A, ...KINDS_B, ...KINDS_T, ...KINDS_I, ...KINDS_INFRA };
const DATA = JSON.parse(document.getElementById("t3-kit-data").textContent);

// The kit fetches its fixtures relative to the site; serve them from the bundled copy only.
window.fetch = (url) => {
  const key = String(url).replace(/^\.?\//, "");
  return key in DATA
    ? Promise.resolve(
        new Response(JSON.stringify(DATA[key]), {
          headers: { "content-type": "application/json" },
        }),
      )
    : Promise.reject(new TypeError(`Offline card document has no ${key}`));
};

function post(message) {
  const text = JSON.stringify({ source: "t3-kit", ...message });
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(text);
  else if (window.parent !== window) window.parent.postMessage(text, "*");
}

const defaultApp = (kind) =>
  kind.startsWith("trace")
    ? "omp-stats"
    : kind.startsWith("intel")
      ? "z0intelligence"
      : kind === "intent-declare"
        ? "ripple"
        : kind.startsWith("intent")
          ? "aodl"
          : catalog.apps.find((app) => app.kinds?.includes(kind))?.id;

function failTile(kind, reason) {
  const tile = document.createElement("div");
  tile.className = "t3-kit-fail";
  tile.setAttribute("role", "alert");
  tile.textContent = `${kind}: ${reason}`;
  post({ type: "error", kind, reason });
  return tile;
}

async function boot() {
  const config = window.__T3_KIT_CARDS ?? { scheme: "dark", cards: [] };
  await Promise.all([loadApps(), loadThemes()]);
  state.base =
    state.themes.find(
      (theme) => theme.id === (config.scheme === "light" ? "t3-light" : "t3-dark"),
    ) ?? state.base;
  apply(false);
  const root = document.getElementById("t3-kit-root");
  const intentInput = config.cards.some(
    (card) => card.kind.startsWith("intent") || card.kind.startsWith("intel"),
  )
    ? await intentReady()
    : null;
  for (const card of config.cards) {
    const cell = document.createElement("section");
    cell.className = "t3-kit-cell";
    cell.dataset.kind = card.kind;
    root.append(cell);
    const K = KINDS[card.kind];
    if (!K) {
      cell.append(failTile(card.kind, "not in this kit build"));
      continue;
    }
    const id = card.app ?? defaultApp(card.kind);
    const app = catalog.byId[id] ?? { id: id ?? card.kind, name: id ?? card.kind, hex: null };
    const intent = card.kind.startsWith("intent") || card.kind.startsWith("intel");
    const options = {
      ...(card.options ?? {}),
      onReview: (request) =>
        post({
          type: "intent",
          detail: {
            v: 0,
            kind: card.kind,
            app: app.id,
            action: "request_review",
            label: "Review requested (not approved)",
            ids: [`card:${card.kind}`],
            entities: { card: card.kind },
            request,
          },
        }),
    };
    try {
      const made = K.make(
        app,
        rng(app.id + card.kind),
        card.input ?? (intent ? intentInput : undefined),
        options,
      );
      cell.append(made.el);
      made.done?.catch?.((error) =>
        cell.replaceChildren(failTile(card.kind, error?.message ?? String(error))),
      );
      if (made.play) quiet(Promise.resolve(made.play(new Run())));
    } catch (error) {
      cell.append(failTile(card.kind, error?.message ?? String(error)));
    }
  }
  document.documentElement.dataset.ready = "true";
}

document.addEventListener("eui:intent", (event) => post({ type: "intent", detail: event.detail }));
let lastHeight = 0;
new ResizeObserver(() => {
  const height =
    Math.ceil(document.getElementById("t3-kit-root").getBoundingClientRect().height) + 16;
  if (height !== lastHeight) post({ type: "height", value: (lastHeight = height) });
}).observe(document.getElementById("t3-kit-root"));
boot().catch((error) =>
  document
    .getElementById("t3-kit-root")
    .append(failTile("document", error?.message ?? String(error))),
);
