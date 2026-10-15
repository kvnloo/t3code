# Claude plugin slash completion: diagnostic QA

**Result: FAIL_GAP. Opt-in diagnostic evidence, not a merge-ready regression or a production fix.**

At upstream PR [#15662](https://github.com/pingdotgg/t3code/pull/15662) head `b633c9cae6af0a30a33a73ce7ce4cee5204e34b6`, real filesystem plugin discovery produces `mattpocock-skills:implement`. The real inventory helper removes its duplicate provider command. Completion for `please use\n/impl` then finds exactly one skill, while the Claude provider command `/context` is excluded after the earlier line.

The required same-line case, `please use /impl`, fails: actual `detectComposerTrigger` returns `null`, rather than a slash trigger with query `impl`. [Issue #19847](https://github.com/pingdotgg/t3code/issues/19847) explicitly requires that same-line behavior. The assertion has not been weakened to accept `null`. This is module-chain evidence on this pinned head; it does not establish browser behavior, skill dispatch, or behavior on current main.

The test is stored as `claudePluginSlashMenu.test.ts.txt` so it does not enter the default test suite. No production code or package manifest was changed. Upstream implementation credit remains with Maria (`maria-rcks`), with Moinax and shivamhwp credited by her PR. This branch contributes agent-assisted diagnostic QA only.

## Reproduce in an isolated checkout

Copy this evidence directory into an isolated checkout of the pinned upstream head above, then run the commands below with Node 24.19.0 and pnpm 11.10.0. Preserve the committed lockfile and patches. The verified environment used Vite Plus 1.0.0, its Vitest 5.0.1 runner, and Effect / @effect/vitest / @effect/platform-node 4.0.2. The committed @effect/vitest patch imports `vite-plus/test`.

```sh
pnpm --filter @t3tools/monorepo --filter 't3...' install --frozen-lockfile --ignore-scripts --store-dir ../qa-store --network-concurrency 2 --child-concurrency 1 --reporter append-only
cp evidence/15662-plugin-slash-pipeline/claudePluginSlashMenu.test.ts.txt apps/web/src/components/chat/claudePluginSlashMenu.test.ts
pnpm exec vp test run apps/web/src/components/chat/claudePluginSlashMenu.test.ts
pnpm exec vp test run apps/server/src/provider/Drivers/ClaudeSkills.test.ts packages/client-runtime/src/providerSkills.test.ts apps/web/src/components/chat/composerSlashCommandSearch.test.ts
```

The focused diagnostic is expected to exit 1: one newline control passes and one same-line requirement fails. The baseline command passes 46 tests across three files: 23 discovery, 16 inventory, 7 composer-search tests.

## Verification accounting and limitations

- Baseline command: two completed invocations, 46/46 each. These are 46 unique existing tests, not 92 distinct tests.
- Initial diagnostic invocation before review correction: one pass and one expected failure. Review changed loop-based registration to `it.effect.each`; assertions remained unchanged.
- Final-byte diagnostic: one independent-review invocation, with one newline pass and one same-line failure, exit 1. There was no additional worker rerun after the `.each` correction. Across both revisions there were two diagnostic invocations, each executing the same two cases; these are two unique cases, not four distinct tests.
- Formatter passed. Scoped lint could not load the repository plugin because the filtered setup did not install `@oxlint/plugins` for `oxlint-plugin-t3code`. No replacement configuration or extra dependency was used.
- Scoped web typecheck exited 1 with TS6307: the diagnostic's direct server-source import is outside the web composite project's file list. This is a diagnostic-packaging limitation, separate from the same-line behavior failure. No tsconfig was changed.
- No pre-fix comparison was performed; this is an exact-head requirement-gap reproduction.
- Setup used official pinned dependencies with lifecycle scripts disabled. The first conservative storage guard stopped installation; the separately authorized continuation completed. Final working allocation was about 2.43 GiB.

## Immutable provenance

- Source archive SHA-256: `fba006f42c2572d35affd1b35107cdc5d64c14438e0947a47a18702b5b229c2a`.
- Lockfile Git blob: `7612acfbbc4aa16b1860d3a552a9b722d19b382c`; SHA-256: `af25008b045c59177e35f3a4cc4ee1796b4838be90471f41b6544204fb9e8c0f`.
- `composer-logic.ts` Git blob: `c26996f494e54458666c28cda34aa059352957c2`.
- Final diagnostic file Git blob: `4959bc36806a1c16666629ddb79d337cb55fca93`; SHA-256: `13c177ddf977afccc7549825b065c44243ac7dab7dff0963f5e8ae03e49ab355`. It is a new file, with no upstream base blob.
- Independent review confirmed all 27,746 original regular source files matched the pinned archive byte-for-byte before and after its final-byte rerun.

Raw log SHA-256 digests follow. The raw logs remain local to the execution workspace, are not durable remote evidence, and are not embedded here because they include sandbox paths:

- Initial 46-test baseline: `9dd5c1f427d79a794833080e61613a11dd3a14012c132c5f7975cdf54bff717f`.
- Repeated 46-test baseline: `ce466bdf7ccc694b38be0baa68b30ba6a0e920256d402dcd786a988f049b92af`.
- Initial diagnostic: `c120acefe1b3e9e77e1981380cdd986fec3a85f19ac59c3056394bd7ce862402`.
- Independent final-byte diagnostic: `f94dc4f15ecf4b41d3334d2aa516e043adc2f46d2535264aefd390f5c3459087`.
- Scoped lint: `5b3350ec74a82ab94070ea660ab2fcbe7340e216128e8388dec9690533675375`.
- Scoped web typecheck: `ca94915f16d55d6139214c2db0cd4d58e55c042c6c2380e79c06705d07d92dca`.
