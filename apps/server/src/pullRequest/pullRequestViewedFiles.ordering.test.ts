import { it as effectIt } from "@effect/vitest";
import { ProjectId, PullRequestOperationError, type PullRequestRef } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { describe, expect } from "vite-plus/test";

import { make as makeViewedFiles } from "./pullRequestViewedFiles.ts";
import type { SupportedProject } from "./PullRequestService.ts";

/**
 * Adversarial timing repro: a reader ticks a file and, one client flush (400ms) later, unticks
 * it again. The tick's host round trip is slower than the untick's (the first press pays the
 * pull-request node-id lookup; the second hits the cache), so without per-change-request write
 * ordering the untick's mutation lands first and the tick's lands after — leaving a stale tick
 * standing over the later untick on the host.
 */
describe("pullRequestViewedFiles host write ordering", () => {
  effectIt.effect(
    "serializes host-backed files-viewed writes per change request in press order",
    () =>
      Effect.gen(function* () {
        const started: Array<"tick" | "untick"> = [];
        const completed: Array<"tick" | "untick"> = [];
        const releaseTick = yield* Deferred.make<void>();
        const releaseUntick = yield* Deferred.make<void>();
        const tickStarted = yield* Deferred.make<void>();

        const project = {
          cursorKey: "test-cursor",
          project: { id: "project-1", workspaceRoot: "/tmp/wt" },
          api: {
            kind: "github",
            capabilities: { viewedFiles: "host" },
            setFilesViewed: (input: {
              readonly files: ReadonlyArray<{ readonly path: string; readonly viewed: boolean }>;
            }) =>
              Effect.gen(function* () {
                const which = input.files[0]?.viewed === true ? "tick" : "untick";
                started.push(which);
                if (which === "tick") {
                  yield* Deferred.succeed(tickStarted, undefined);
                  // Fault injection: the tick's host round trip stays in flight while the
                  // untick's runs, mirroring the cold node-id lookup vs the warm cache.
                  yield* Deferred.await(releaseTick);
                } else {
                  yield* Deferred.await(releaseUntick);
                }
                completed.push(which);
              }),
          },
          repository: "org/repo",
          host: "github.com",
          remote: "github.com/org/repo",
        } as unknown as SupportedProject;

        const viewedFiles = makeViewedFiles({
          filesViewedStore: undefined as never,
          requireProject: () => Effect.succeed(project),
          requiredViewerOf: () => Effect.succeed("viewer"),
          toPullRequestError: (operation: string) => (cause: unknown) =>
            new PullRequestOperationError({ operation, detail: "test failure", cause }),
          runFork: () => undefined,
          refEpoch: () => 0,
          fileRevisionsEpoch: () => 0,
        });

        const ref: PullRequestRef = {
          projectId: ProjectId.make("project-1"),
          repository: "org/repo",
          number: 7,
        };
        const tickFiber = yield* Effect.forkDetach(
          viewedFiles.setFilesViewed({ ...ref, files: [{ path: "a.ts", viewed: true }] }),
        );
        // The tick's write is parked in flight before the untick's press is even sent.
        yield* Deferred.await(tickStarted);
        const untickFiber = yield* Effect.forkDetach(
          viewedFiles.setFilesViewed({ ...ref, files: [{ path: "a.ts", viewed: false }] }),
        );
        // Let the untick's fiber run to wherever it blocks: the host write on an unordered
        // server, the per-change-request gate on an ordered one.
        yield* Effect.yieldNow;

        // The untick must not start its host write while the tick's is still in flight.
        expect(started).toEqual(["tick"]);

        yield* Deferred.succeed(releaseUntick, undefined);
        yield* Deferred.succeed(releaseTick, undefined);
        yield* Fiber.join(tickFiber);
        yield* Fiber.join(untickFiber);

        // The host applies writes in completion order, so the last press must land last.
        expect(completed).toEqual(["tick", "untick"]);
      }),
  );
});
