// Demo-only: call one MCP tool on the running nightly server as the machine's
// owner, the way `t3 thread` does. Usage: node .demo-mcp.ts <tool> '<json>'
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NetService from "@t3tools/shared/Net";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";

import * as EnvironmentAuth from "./src/auth/EnvironmentAuth.ts";
import * as ServerConfig from "./src/config.ts";
import { mcpToolSession } from "./src/mcp/AcpMcpStdioBridge.ts";
import { readPersistedServerRuntimeState } from "./src/serverRuntimeState.ts";
import { resolveCliAuthConfig } from "./src/cli/config.ts";

const [tool, json] = process.argv.slice(2);
const baseDir = process.env.T3CODE_HOME!;

const program = Effect.gen(function* () {
  const config = yield* resolveCliAuthConfig({ baseDir: Option.some(baseDir) }, Option.none());
  return yield* Effect.gen(function* () {
    const state = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
    const origin = Option.getOrThrow(state).origin;
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const issued = yield* Effect.acquireRelease(
      auth.issueMcpClientSession({
        label: "nightly demo",
        access: "full-access",
        peerLink: false,
        client: { deviceType: "bot" },
      }),
      (s) => auth.revokeSession(s.sessionId).pipe(Effect.ignore),
    );
    const session = yield* mcpToolSession({
      endpoint: new URL("/mcp", origin).href,
      authorization: `Bearer ${issued.token}`,
      clientName: "nightly-demo",
    });
    const result = yield* session.call(tool!, JSON.parse(json!));
    console.log(JSON.stringify(result));
  }).pipe(
    Effect.scoped,
    Effect.provide(
      EnvironmentAuth.layerRuntime.pipe(
        Layer.provide(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, config.logLevel)),
      ),
    ),
  );
});

NodeRuntime.runMain(program.pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, NetService.layer))));
