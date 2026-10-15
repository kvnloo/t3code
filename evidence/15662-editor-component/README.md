# #15662: synthetic-merge editor-component diagnostic

Classification: **LIMITED**, opt-in downstream evidence. This diagnostic connects actual installed-plugin discovery and slash-search helpers to the real mounted React/Tiptap editor, then to the pure Claude dispatch planner. It does **not** exercise ChatComposer's selection callback, a browser, or a provider.

## Revision and result

- Tested GitHub synthetic merge: `99b5739268a9aeb1fc9ae9251984892341b74fcd`.
- Owner PR head remains `b633c9cae6af0a30a33a73ce7ce4cee5204e34b6`; origin PR was open at inspection. Reported current base was `6cd02e98f7edd78b7bde9ceff26c829476dbeb77`, not the runtime-tested revision.
- Scope: [downstream #41 claim](https://github.com/kvnloo/t3code/issues/41#issuecomment-6200316522), 15 minutes and 256 MiB newly allocated storage. No dependency installation or production edits.
- Existing editor navigation baseline: **9/9 passed**.
- Final diagnostic: **4/4 passed**. Independent exact-byte rerun: **4/4 passed**.
- Final diagnostic SHA-256: `b374c4b15bafd104fa6fa670d77430d446738efcf5f9311dced7ccba73abfaf2`.

## What the four cases establish

Both `please use /impl` and `please use\n/impl`, each in rich and plain editor mode:

1. Create temporary installed-plugin files, enable the plugin, and run the real `discoverClaudeSkills`. The resulting name is `mattpocock-skills:implement`.
2. Run real skill-inventory, command-deduplication, trigger and search helpers. The colliding provider slash command is removed; an unrelated provider command is excluded after ordinary text; the namespaced skill remains discoverable.
3. Mount the imported `ComposerPromptEditor` in JSDOM with the incomplete prompt. Select the search result **in the harness**, run the public replacement/cursor helpers, and supply the next controlled value to the same mounted editor.
4. Observe one actual atomic ProseMirror skill node and rendered chip; confirm exact serialized prompt and namespaced identity. Inspect the actual collapsed ProseMirror selection immediately after its trailing space.
5. Call the real editor's `insertContent("and explain")` command at that selection. Verify the prefix, skill, suffix, serialized value, cursor and emitted change survive. This is an editor-command transaction, not browser keystrokes.
6. After asserting the editor serialization equals the expected final prompt, pass that prompt to the actual pure `planClaudeSkillDispatch`. It recognizes the discovered namespaced token and preserves `please use` as leading text and `and explain` as command arguments. An empty known-skill set produces no plan.

No production modules are mocked. The only global stub is React's act-environment flag. No production selection callback is extracted or copied.

## Boundaries and observations

- The harness bridges search to controlled editor props. It does not mount the full ChatComposer, click its menu, press selection keys, exercise its expected-text/race guard, or prove its focus scheduling.
- JSDOM is not a real browser. Layout, pointer/keyboard behavior, provider handshake, transport, SDK/CLI dispatch, and live plugin execution remain unverified.
- `planClaudeSkillDispatch` is a pure plan builder. Its successful assertion is not a provider invocation.
- All four diagnostic cases emit React's `flushSync was called from inside a lifecycle method` warning during controlled chip insertion. Warnings remain in raw logs and were not suppressed. Assertions pass; this observation alone does not establish user-visible impact.
- Stage totals: **13 unique cases, 21 reported case executions: 17 passed and 4 initial harness assertion failures**.
- The first baseline invocation was interrupted before any reported tests because the allocation watchdog raced a disappearing Vite temporary file. The watchdog was narrowed to tolerate only missing-file races; the unchanged baseline then passed.
- The initial diagnostic had four failed assertions because this harness expected an incomplete accessible label. The actual component appends `. Show details`; correcting that expectation and adding direct selection assertions led to the final pass. No production code changed, and this is **not** a product RED/GREEN result.
- This is an opt-in `.tsx.txt` artifact, not a merge-ready default regression. Formatting ran successfully. Lint and typecheck were not run in this stage; earlier cross-package test-placement limits remain relevant.
- Tests use isolated HOME/TMP and offline package-manager settings. No network namespace isolation is claimed or attempted.

## Reproduce in the already-qualified pinned workspace

Use the existing frozen official dependency installation from the [synthetic-merge packet](https://github.com/kvnloo/t3code/blob/57c238f3e060faa9153ea5ab5091e342d0362e5b/evidence/15662-synthetic-merge/README.md). Do not install or alter dependencies as part of this diagnostic.

1. Confirm the source and package hashes in `receipt.json`.
2. Copy `claudePluginEditorInsertion.diagnostic.test.tsx.txt` to the absent path `apps/web/src/components/chat/claudePluginEditorInsertion.diagnostic.test.tsx`.
3. With isolated HOME/TMP and offline package-manager settings, use the existing pinned pnpm 11.10.0 executable:

   `node "$PNPM" exec vp test run apps/web/src/components/ComposerPromptEditorTiptap.navigation.test.tsx`

   `node "$PNPM" exec vp test run apps/web/src/components/chat/claudePluginEditorInsertion.diagnostic.test.tsx`

4. Preserve logs, then remove only the temporary diagnostic copy after verifying its exact hash. Preserve all original source and previous evidence.

The complete command arrays, run outcomes, evidence hashes, counts, preservation checks and software versions are in `receipt.json`. Raw logs and earlier failed diagnostic bytes are retained locally; no credentials or private runtime data are in this packet.

Credit: Maria (maria-rcks) owns plugin discovery; Moinax and shivamhwp retain precursor credit. Bil0000 owns the existing inline-trigger implementation. This work adds downstream verification only.
