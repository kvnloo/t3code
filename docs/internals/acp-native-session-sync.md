# ACP native session sync (design sketch, not implemented)

Status: proposal. Base: `origin/main` d01b92c061. The Phase 1 stopgap runs outside T3 as a user
timer (`/mnt/zer0models/workspace/zer0/data/operations/t3-acp-sync/`); this note covers moving
that behavior into the server so every client gets it, including mobile, which has no ACP session
management UI.

## Problem

ACP agents that keep their own session store (Hermes: Tern, Hermes app, gateways) start sessions
T3 never sees. Today they reach T3 only through Settings → provider instance → ACP session
management → pick project → List → Import. That flow is web-only, manual, per project, and
creates a thread with **no transcript**: import emits `thread.created` plus a `not_loaded`
provider thread (`apps/server/src/orchestration-v2/Orchestrator.ts`, `importedNativeThread`
branch), and nothing calls the adapter's `readThreadSnapshot`
(`packages/provider-acp/src/server/adapter.ts`). When the thread later resumes,
`AcpSessionRuntime` drops replayed history (`sessionUpdateIsReplay` and the load gate in
`packages/provider-acp/src/server/AcpSessionRuntime.ts`).

## Smallest model

One opt-in, per-instance setting and one reactor. Everything else reuses existing code.

1. **Setting.** `syncNativeSessions?: boolean` on the acpRegistry driver config
   (`packages/provider-acp-registry/src/settings.ts`), not on the generic
   `ProviderInstanceConfig` (`packages/contracts/src/providerInstance.ts`), because only
   session-listing drivers can honor it. Default off. It is shown as a toggle in the existing
   section (`apps/web/src/components/settings/AcpSessionManagementSection.tsx`) and, because the
   setting syncs through server settings, also works from mobile with no new mobile UI.
2. **Reactor.** `apps/server/src/orchestration-v2/AcpNativeSessionSyncReactor.ts`, registered
   next to `PullRequestSyncReactor` in `apps/server/src/server.ts`. For each enabled instance
   with `syncNativeSessions`, on a `Schedule.spaced` tick (and once on startup):
   - list sessions per project with the existing `listAcpRegistrySessions` logic, lifted out of
     `apps/server/src/ws.ts` (`listAcpRegistrySessions` / `importAcpRegistrySession`) into a
     shared `apps/server/src/provider/AcpNativeSessionImport.ts` so the RPC and the reactor share
     one code path;
   - skip sessions already imported (derived thread id exists) **and** sessions any T3 thread
     already drives (`nativeThreadRef.nativeId` on a provider thread for that instance). Phase 1
     needed a read of `orchestration_v2_projection_provider_threads` for this; in-server it is a
     ProjectionStore lookup. Without it, T3-started ACP threads get twins;
   - import, newest first, with a per-tick cap.
3. **Reverse state.** Turning the toggle off stops the reactor for that instance. Imported
   threads stay; they are ordinary threads (archive/delete as usual). No hidden state is left
   to clean up.

## Things the reactor must not get wrong

- **Process cost.** Every `listSessions` call spawns the agent (`probe.ts`
  `makeAcpRegistryManagementRuntime`): Phase 1 measured ~4 s per call, so 3 instances × 25 projects
  took ~5 min per sweep. The reactor should keep one management runtime per instance per sweep
  and page through `session/list` once without `cwd` (the ACP filter is optional; check each
  agent honors that), then bucket sessions by `cwd` against project roots, instead of one spawn
  per project.
- **Origin.** ACP `SessionInfo` has no "who created this" field. Hermes records it
  (`created_source`); the clean way to carry it is ACP `_meta` on `session/list`, decoded in
  `probe.ts` into an optional `origin` on `AcpRegistrySession`
  (`packages/contracts/src/acpRegistry.ts`). Until then, rely on the T3-bound check above.
- **Ordering.** Imported threads get `createdAt` = import time, so a week-old session lands at
  the top of the sidebar. Pass the native `updatedAt` through as the thread's `updatedAt`, or sort
  imported threads by `nativeMetadata.updatedAt`.
- **Transcript.** Import should hydrate history once: call the adapter's `readThreadSnapshot`
  (already implemented for ACP agents that advertise `loadSession`) and project its messages, the
  same way `apps/server/src/project/AgentSessionImporter.ts` projects Codex/Claude transcripts.
  That is a separate PR from sync; without it a synced thread is a title with an empty body.
- **Liveness.** Turns the user later runs in the native client (Tern) never reach T3: nothing
  watches the agent's store, and resume drops replay. A cheap version: when a synced thread is
  visited and the listed `updatedAt` is newer than the last hydration, re-run the snapshot read
  and append the new messages. True live mirroring needs an agent-side push and is out of scope.
- **Remote.** The reactor runs where the agent runs (the environment), so remote/relay clients and
  mobile see synced threads through the normal shell stream; nothing per-client.

## Tests (when implemented)

- Reactor with a fake `acpSessionManagement`: imports only unimported, unbound, recent sessions;
  respects the cap; idempotent across ticks; stops when the toggle flips off.
- Shared import module: RPC path and reactor path produce the same thread id and events.
