# ephemeral-ui integration — Gallery first

Branch: `exp/openui-gallery`. Base: `experiment/openui-app-cards` at `aa0284ae0a`.
Target: fork `channels/nightly`. **Not yet merged, built, installed or device-qualified.**

## Why this base

The native/web OpenUI app cards are already implemented on `experiment/openui-app-cards` but not on nightly. Preserve that work; do not recreate it. Nightly has chart boards but not those cards. This branch must be reconciled with nightly before release.

## First vertical slice

Port the ephemeral-ui gallery interaction into the existing `openui-v2` catalog, rather than sending a large one-off `html_render` page. The source of the design is `products/launch-videos/pretotypes/ephemeral-ui/src/js/kinds-c.js` (`galleryMake`) and its shell; the carousel adds the group accent, caption overlay, thumbnail strip, tags and local starring used in the trading research prototype.

- Shared component contract, bounded input and validation in `packages/client-runtime/src/openUiGallery.ts`.
- Web card: drag/swipe, arrows/keyboard, thumbnails, group accents, tags, notes, local stars, full-size overlay and optional http(s) source link.
- Native Android card: paging ScrollView, native image loader, thumbnails, group accents, tags, notes, local stars and full-screen modal.
- No generated event handlers, tool calls, mutations or automatic order execution. Selection is local and can reset when a conversation remounts. No time-to-live eviction of research images.
- Images are small references. Web signs host files through the same `media-file` asset route as Markdown. Native cards receive the thread's `resolveImageSource`, preserving host file authorization and remote connectivity rules. Normal Markdown retains its lazy-loading boundary.

## Catalog syntax

```openui-v2
root = Board("Native trading terminals", "Screenshots from the checked repositories.", [shots])
shots = Gallery("Trading terminals", [{image: "/absolute/path/terminal.jpg", title: "Terminal", caption: "Bloomberg amber theme", group: "Terminal", tags: [{text: "Rust · egui", tone: "ok"}, {text: "no licence", tone: "bad"}], note: "A design reference, not a licensed fork base.", link: "https://github.com/michaelshimeles/terminal"}])
```

Arguments: `Gallery(title, slides)`. Each slide requires `image` and `title`; optional `caption`, `group`, `tags`, `note`, `link`. Tag tones: `ok`, `warn`, `bad`, `info`. Maximum 24 slides and 6 tags per slide. The overall board still has its 64 KiB limit. No data: image payloads or executable schemes.

## Verification actually run

`fleet-build --node phones --light ... -- node experiments/openui-lab/gallery-node-tests.mjs`

Receipt: fleet job `20261103-131759-77f3`, galaxy-s22plus guest Node execution, exit 0; **4 tests passed**:

1. Group/accent stability and first-slide indices.
2. Wraparound navigation, distance/flick swipe decisions, counters and screen-reader labels.
3. File/http(s) image sources and rejection of executable/data schemes.
4. Board cross-field rejection of invalid image/link values.

These are shared logic tests, **not Android UI tests**. `gallery-node-tests.mjs` runs the same assertions with Node's test runner without installing the monorepo toolchain.

## Outstanding before promotion

- Project typechecks and focused browser suite: `apps/web/src/components/chat/OpenUiGallery.browser.test.tsx` exists but has NOT run.
- Native render, swipe, full-screen, back, failed-image and reconnect tests on the exact Android app build.
- Full-size viewer accessibility/focus and gesture/zoom parity with T3's existing image viewer.
- Actual trading screenshot dogfood in an ordinary chat, at desktop and phone widths, light and dark.
- Update agent orchestration instructions with the Gallery signature only once both clients have shipped it.
- Reconcile app-card branch with current nightly; push a draft PR and link it; merge/deploy only after evidence is green.

## Current environment blockers

- `pnpm install --frozen-lockfile --prefer-offline` did not complete. Its offline retry failed because provider-utils metadata was missing in the inherited package mirror. Existing dependencies were linked read-only from the app-card experiment checkout into this checkout; workspace package links point back to THIS checkout. No donor source files were modified.
- MBP verification queue is held (`fleet-build --node mbp --light` waited before source staging and timed out). Do not route full builds onto groot to bypass the hold. The supported light-test fallback on the phone succeeded.

This slice is implementation in progress, not a claim that the screenshot failure was diagnosed or that Gallery is available in the installed nightly app.
