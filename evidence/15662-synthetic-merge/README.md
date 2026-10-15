# Claude plugin slash completion: synthetic-merge QA

## Result

On GitHub's existing synthetic merge `99b5739268a9aeb1fc9ae9251984892341b74fcd`, all **160 baseline tests pass**, and the unchanged two-case discovery-to-menu diagnostic passes for both `please use /impl` and `please use\n/impl`. An independent rerun of the exact diagnostic also passed **2/2**, with unchanged source and test bytes.

This qualifies the helper integration at this synthetic merge. It does not validate current main, a browser, skill selection/insertion in the actual composer, the provider handshake, or dispatch.

## Why the old failure differs

[The prior diagnostic](https://github.com/kvnloo/t3code/blob/1eed7a0ee14d697103cef018db144b305be3c86e/evidence/15662-plugin-slash-pipeline/README.md) was correctly pinned to Maria's old PR head `b633c9cae6af0a30a33a73ce7ce4cee5204e34b6`: its newline control passed, but the same-line trigger returned null. That result remains preserved.

After the old head was authored, [Bil0000's #19107](https://github.com/pingdotgg/t3code/pull/19107) merged on October 13, supplying the inline trigger implementation. It is present on both the issue reporter's main `339179f50a84dc599cce373dbb48f172f182f44e` and inspected main `3ff452bd65adf758e68b886d1e3778ae1ec7d970`. A duplicate trigger patch is unnecessary.

The tested merge joins base `2d31acb9751d89fd00f2b3fd0725b37ed9109440` with Maria's head. Its base is **21 commits behind inspected main**. Discovery source/tests match the old owner head; the web/shared triggers, provider inventory and slash-search helpers match inspected main. Different dependencies and other source changes prevent treating the two snapshots as a controlled single-change RED/GREEN experiment.

## Executed coverage

- ClaudeSkills.test.ts: 23 passed
- providerSkills.test.ts: 16 passed
- composerSlashCommandSearch.test.ts: 7 passed
- Web composer-logic.test.ts: 94 passed
- Shared composerTrigger.test.ts: 20 passed
- Exact published diagnostic, producer: 2 passed
- Independent diagnostic: 2 passed
- This stage: **162 unique cases, 164 case executions, all passed** (160 + 2 + 2)

The diagnostic writes actual temporary plugin files, runs actual discovery, checks the namespaced identity/path, removes the colliding provider command, detects the real prompt token, matches `impl`, and excludes the provider `/context` command after other text. SDK command inventory and menu-item construction are fixtures. The original diagnostic's historical comment about exposing a gap remains unchanged to preserve exact previously reviewed bytes.

## Reproduce

Use a fresh checkout/archive of the exact tested merge. Node 24.19.0 and official pnpm 11.10.0 were used, with Vite Plus 1.0.0 and Effect, @effect/vitest, and @effect/platform-node 4.0.4. `$PNPM_CLI` below denotes the previously integrity-verified official executable; `$STORE` denotes the reusable pnpm content-addressed store. Commands are normalized only for machine-local paths.

```sh
node "$PNPM_CLI" --filter @t3tools/monorepo --filter 't3...' install --frozen-lockfile --ignore-scripts --store-dir "$STORE" --network-concurrency 2 --child-concurrency 1 --reporter append-only
node "$PNPM_CLI" exec vp test run apps/server/src/provider/Drivers/ClaudeSkills.test.ts packages/client-runtime/src/providerSkills.test.ts apps/web/src/components/chat/composerSlashCommandSearch.test.ts apps/web/src/composer-logic.test.ts packages/shared/src/composerTrigger.test.ts
cp /path/to/claudePluginSlashMenu.test.ts.txt apps/web/src/components/chat/claudePluginSlashMenu.test.ts
node "$PNPM_CLI" exec vp test run apps/web/src/components/chat/claudePluginSlashMenu.test.ts
```

Fresh node_modules were created by pnpm; no old node_modules were copied. Install completed in 20.36 seconds, reusing 1,066 packages and downloading 19. Lifecycle scripts remained disabled and committed patches were preserved. Initial setup and producer qualification took 131.2 seconds and approximately 2.56 GiB new allocation including shared-store growth, within the 10-minute/4-GiB limit and 3.5-GiB early stop. All 28,079 original archive files remained unchanged. Independent review compared every original file directly with the archive before and after its run and checked all 3,515 dependency symlinks: none resolved outside the fresh source. New allocation after independent execution was 2,763,337,728 bytes, including shared-store growth. The previous owner-head workspace's 27,746 original source files and phase-two log manifest also remained unchanged.

The independent test used isolated HOME/TMP and offline package-manager configuration. An optional no-op `unshare -n true` probe failed with `Operation not permitted`, was not retried, and contained no test. The subsequent ordinary authorized test had no kernel-enforced network isolation.

## Integrity and limits

- Archive SHA-256: `95ef62076326c37b87df951e181cf3ac4a7c93a9fc5ed6bcc2ee86c9e3c62959`
- Lockfile Git blob: `b6cc9b75ca88de44fe8c75613a870224069d46d0`
- Lockfile SHA-256: `6342162d528261bed2d8e2d09fc11212465b4615e58e1047a615b20994990965`
- Independent diagnostic log SHA-256: `40e958c82cdc912624d5ed5308862d45ded7c7e4bcd34b5245dff6980761a3e3`
- Diagnostic SHA-256: `13c177ddf977afccc7549825b065c44243ac7dab7dff0963f5e8ae03e49ab355`

[receipt.json](receipt.json) records normalized commands, per-file source hashes, exact counts, raw-log hashes, resources and limitations. Raw logs remain local. This `.ts.txt` diagnostic is opt-in and is not a merge-ready default test: prior web-composite TS6307 and unresolved @oxlint/plugins limitations remain disclosed. Lint/typecheck were not rerun or repaired here. No production edit, reconstructed rebase, provider call, upstream post, merge or browser action was performed.

Discovery credit remains with Maria (`maria-rcks`) and precursors Moinax/shivamhwp. Bil0000 owns the merged inline-trigger implementation. Downstream QA: OpenAI assistant via Codex.
