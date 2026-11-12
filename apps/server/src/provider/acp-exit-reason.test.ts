// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  ThreadId,
} from "@t3tools/contracts";
import * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import {
  makeProviderFailure,
  makeProviderFailureTurnItem,
} from "@t3tools/provider-core/server/failure";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

const diagnostic = [
  "old startup output\n".repeat(300),
  ...Array.from({ length: 30 }, (_, index) => `noise ${index}\n`),
  "Authorization: Bearer fixture-bearer\n",
  "api_key=fixture-api-key ghp_fixturecredential\n",
  "credential setup failed\n",
].join("");

function errorItem(cause: unknown) {
  return makeProviderFailureTurnItem({
    driver: ProviderDriverKind.make("acpRegistry"),
    threadId: ThreadId.make("thread:acp-exit"),
    runId: null,
    nodeId: null,
    providerThreadId: ProviderThreadId.make("provider-thread:acp-exit"),
    providerTurnId: ProviderTurnId.make("provider-turn:acp-exit"),
    itemOrdinal: 0,
    occurredAt: DateTime.makeUnsafe("2026-11-04T00:00:00Z"),
    failure: makeProviderFailure({ cause }),
  });
}

const cases = [
  { name: "startup exit code", method: "initialize", outcome: "exit", status: "code 1" },
  { name: "turn exit code", method: "session/prompt", outcome: "exit", status: "code 1" },
  ...(HostProcess.Platform.defaultValue() === "win32"
    ? []
    : [{ name: "turn signal", method: "session/prompt", outcome: "signal", status: "SIGTERM" }]),
  { name: "session rejection", method: "session/new", outcome: "reject", status: "Internal error" },
  { name: "load timeout", method: "session/load", outcome: "timeout", status: "timed out" },
];

it.effect.each(cases)(
  "puts bounded, redacted diagnostics in the error item for $name",
  (testCase) =>
    Effect.gen(function* () {
      const stderrRead = yield* Deferred.make<void>();
      const runtime = yield* AcpSessionRuntime.make({
        cwd: process.cwd(),
        clientInfo: { name: "acp-exit-test", version: "0.0.0" },
        ...(testCase.outcome === "timeout"
          ? { resumeSessionId: "fixture-session", sessionLoadTimeout: "1 second" }
          : {}),
        onStderr: (text) =>
          text.includes("credential setup failed")
            ? Deferred.succeed(stderrRead, undefined).pipe(Effect.asVoid)
            : Effect.void,
        spawn: {
          command: process.execPath,
          shell: false,
          args: [
            "-e",
            `
            const readline = require("node:readline");
            readline.createInterface({ input: process.stdin }).on("line", (line) => {
              const request = JSON.parse(line);
              if (request.id === undefined) return;
              const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
              if (request.method === ${JSON.stringify(testCase.method)}) {
                process.stderr.write(${JSON.stringify(diagnostic)}, () => {
                  const outcome = ${JSON.stringify(testCase.outcome)};
                  if (outcome === "exit") process.exit(1);
                  if (outcome === "signal") process.kill(process.pid, "SIGTERM");
                  if (outcome === "reject") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: "Internal error" } }) + "\\n");
                });
                return;
              }
              reply(request.method === "initialize"
                ? { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] }
                : { sessionId: "fixture-session" });
            });
          `,
          ],
        },
      });
      const operation = Effect.gen(function* () {
        yield* runtime.start();
        return yield* runtime.prompt({ prompt: [{ type: "text", text: "hello" }] });
      });
      const pending = yield* operation.pipe(Effect.flip, Effect.forkChild);
      if (testCase.outcome === "timeout") {
        yield* Deferred.await(stderrRead);
        yield* TestClock.adjust("1 second");
      }
      const cause = yield* Fiber.join(pending);
      const wrapped = new ProviderAdapter.ProviderAdapterOpenSessionError({
        driver: ProviderDriverKind.make("acpRegistry"),
        providerSessionId: ProviderSessionId.make("provider-session:acp-exit"),
        cause,
      });
      const item = errorItem(wrapped);
      assert.include(item.failure.message, testCase.status);
      assert.include(item.failure.message, "credential setup failed");
      assert.include(item.failure.message.toLowerCase(), "retry");
      assert.notInclude(item.failure.message, "fixture-bearer");
      assert.notInclude(item.failure.message, "fixture-api-key");
      assert.notInclude(item.failure.message, "ghp_fixturecredential");
      assert.notInclude(item.failure.message, "old startup output");
      assert.notInclude(item.failure.message, "noise 0\n");
      assert.isAtMost(item.failure.message.length, 2_500);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);
