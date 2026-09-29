import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import { githubMediaResponse } from "./GitHubMediaFetch.ts";

/** Mirrors the per-hop bound in GitHubMediaFetch: one stalled hop must not park the route. */
const PER_HOP_TIMEOUT_MS = 10_000;

describe("githubMediaResponse", () => {
  it.effect("answers 502 when a redirect hop never answers", () =>
    Deferred.make<void>().pipe(
      Effect.flatMap((requestStarted) =>
        Effect.gen(function* () {
          // Race the media fetch against a probe past the per-hop bound: with the
          // timeout the fetch loses the race and the route answers 502; without
          // it the fetch never settles and the probe wins instead.
          const outcomeFiber = yield* Effect.raceFirst(
            githubMediaResponse(
              {
                url: "https://raw.githubusercontent.com/owner/repo/main/shot.png",
                cwd: "/repo",
                expiresAt: Number.MAX_SAFE_INTEGER,
              },
              {},
            ).pipe(Effect.map((response) => response.status)),
            Effect.sleep(PER_HOP_TIMEOUT_MS * 3 + 1_000).pipe(
              Effect.as("still-parked" as const),
            ),
          ).pipe(Effect.forkChild);
          // The clock only moves once the request is actually in flight, so the
          // timeout cannot fire before it is armed and the test pass vacuously.
          yield* Deferred.await(requestStarted);
          yield* TestClock.adjust(PER_HOP_TIMEOUT_MS * 3 + 1_000);
          expect(yield* Fiber.join(outcomeFiber)).toBe(502);
        }).pipe(
          Effect.provide(
            Layer.mock(GitHubCli.GitHubCli)({
              execute: () =>
                Effect.succeed({
                  exitCode: ChildProcessSpawner.ExitCode(0),
                  stdout: "signed-in",
                  stderr: "",
                  stdoutTruncated: false,
                  stderrTruncated: false,
                }),
            }),
          ),
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make(() =>
              Deferred.complete(requestStarted, Effect.void).pipe(
                Effect.andThen(Effect.never),
              ),
            ),
          ),
          Effect.provide(TestClock.layer()),
          Effect.scoped,
        ),
      ),
    ),
  );
});
