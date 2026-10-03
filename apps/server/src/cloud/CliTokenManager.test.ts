import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Terminal from "effect/Terminal";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ExternalLauncher from "../process/externalLauncher.ts";
import * as CliTokenManager from "./CliTokenManager.ts";

// pk_test_<base64 of "clerk.example.test$">
const TEST_ENV = {
  T3CODE_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA==",
  T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_client_test",
  T3CODE_HOSTED_APP_URL: "https://hosted.example.test",
};

interface RecordedTokenRequest {
  readonly url: string;
  readonly params: URLSearchParams;
}

// A JWT whose payload claims { email: "theo@example.test" } (signature is not
// verified — the CLI only reads the claim to display the connected account).
const TestIdTokenHeaderJson = Schema.fromJsonString(Schema.Struct({ alg: Schema.Literal("none") }));
const TestIdTokenPayloadJson = Schema.fromJsonString(Schema.Struct({ email: Schema.String }));
const encodeTestIdTokenHeader = Schema.encodeSync(TestIdTokenHeaderJson);
const encodeTestIdTokenPayload = Schema.encodeSync(TestIdTokenPayloadJson);
const idTokenWithEmail = (() => {
  const header = Encoding.encodeBase64Url(encodeTestIdTokenHeader({ alg: "none" }));
  const payload = Encoding.encodeBase64Url(
    encodeTestIdTokenPayload({ email: "theo@example.test" }),
  );
  return `${header}.${payload}.`;
})();

const TestTokenResponseJson = Schema.fromJsonString(
  Schema.Struct({
    access_token: Schema.String,
    refresh_token: Schema.String,
    id_token: Schema.String,
    expires_in: Schema.Number,
    token_type: Schema.String,
  }),
);
const encodeTestTokenResponse = Schema.encodeSync(TestTokenResponseJson);

const provideTestEnv = Effect.provide(
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: TEST_ENV })),
);

const isAuthorizationError = Schema.is(CliTokenManager.CloudCliAuthorizationError);

const makeTestTerminal = (queue: Queue.Queue<Terminal.UserInput>) =>
  Terminal.make({
    columns: Effect.succeed(80),
    rows: Effect.succeed(24),
    readInput: Effect.succeed(Queue.asDequeue(queue)),
    readLine: Effect.never,
    display: () => Effect.void,
  });

const userInput = (name: string): Terminal.UserInput => ({
  input: Option.some(name),
  key: { name, ctrl: false, meta: false, shift: name !== name.toLowerCase() },
});

it.effect("opens the browser on Enter and switches the active flow on H", () =>
  Effect.gen(function* () {
    const queue = yield* Queue.make<Terminal.UserInput>();
    yield* Queue.offerAll(queue, [userInput("enter"), userInput("H")]);
    const opened: Array<string> = [];

    const result = yield* CliTokenManager.waitForLoopbackAuthorization({
      authorizationUrl: "https://clerk.example.test/authorize",
      callback: Effect.never,
      terminal: makeTestTerminal(queue),
      launchBrowser: (url) =>
        Effect.sync(() => {
          opened.push(url);
        }),
    });

    assert.deepEqual(opened, ["https://clerk.example.test/authorize"]);
    assert.deepEqual(result, { _tag: "HeadlessRequested" });
  }),
);

it.effect("finishes normally when the browser callback wins", () =>
  Effect.gen(function* () {
    const queue = yield* Queue.make<Terminal.UserInput>();
    const callback = yield* Deferred.make<string>();
    yield* Deferred.succeed(callback, "clerk-code-123");

    const result = yield* CliTokenManager.waitForLoopbackAuthorization({
      authorizationUrl: "https://clerk.example.test/authorize",
      callback: Deferred.await(callback),
      terminal: makeTestTerminal(queue),
      launchBrowser: () => Effect.die("browser launch should not run"),
    });

    assert.deepEqual(result, { _tag: "AuthorizationCode", code: "clerk-code-123" });
  }),
);

interface DeviceFlowServer {
  readonly requests: Array<RecordedTokenRequest>;
  /** Token endpoint replies, consumed in order; the last one repeats. */
  readonly tokenReplies: Array<{ readonly status: number; readonly body: string }>;
}

const DEVICE_AUTHORIZATION_BODY = JSON.stringify({
  device_code: "device-code-1",
  user_code: "BCDF-GHJK",
  verification_uri: "https://accounts.example.test/device",
  verification_uri_complete: "https://accounts.example.test/device?user_code=BCDF-GHJK",
  expires_in: 600,
  interval: 5,
});

const oauthError = (error: string) => ({ status: 400, body: JSON.stringify({ error }) });
const tokenGranted = {
  status: 200,
  body: encodeTestTokenResponse({
    access_token: "access-token-1",
    refresh_token: "refresh-token-1",
    id_token: idTokenWithEmail,
    expires_in: 3600,
    token_type: "bearer",
  }),
};

const makeDeviceFlowLayer = (server: DeviceFlowServer) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        const body =
          request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
        server.requests.push({ url: request.url, params: new URLSearchParams(body) });
        const reply = request.url.endsWith("/oauth/device_authorization")
          ? { status: 200, body: DEVICE_AUTHORIZATION_BODY }
          : ((server.tokenReplies.length > 1
              ? server.tokenReplies.shift()
              : server.tokenReplies[0]) ?? oauthError("invalid_grant"));
        return HttpClientResponse.fromWeb(
          request,
          new Response(reply.body, {
            status: reply.status,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    ),
  );

const tokenRequests = (requests: ReadonlyArray<RecordedTokenRequest>) =>
  requests.filter((request) => request.url.endsWith("/oauth/token"));

it.layer(NodeServices.layer)("CliTokenManager.deviceAuthorizationLogin", (it) => {
  it.effect("requests a device code, shows it, and polls until Clerk grants the token", () =>
    Effect.gen(function* () {
      const server: DeviceFlowServer = {
        requests: [],
        tokenReplies: [oauthError("authorization_pending"), tokenGranted],
      };
      const prompts: Array<CliTokenManager.DeviceAuthorizationPrompt> = [];

      const fiber = yield* CliTokenManager.deviceAuthorizationLogin((prompt) =>
        Effect.sync(() => {
          prompts.push(prompt);
        }),
      ).pipe(Effect.provide(makeDeviceFlowLayer(server)), provideTestEnv, Effect.forkChild);

      yield* TestClock.adjust(Duration.seconds(10));
      const { token, identity } = yield* Fiber.join(fiber);

      assert.deepEqual(prompts, [
        {
          verificationUri: "https://accounts.example.test/device",
          verificationUriComplete: "https://accounts.example.test/device?user_code=BCDF-GHJK",
          userCode: "BCDF-GHJK",
          expiresIn: Duration.seconds(600),
        },
      ]);
      assert.equal(token.accessToken, "access-token-1");
      assert.equal(token.refreshToken, "refresh-token-1");
      assert.equal(token.identity, "theo@example.test");
      assert.equal(identity, "theo@example.test");

      const authorization = server.requests[0]!;
      assert.equal(authorization.url, "https://clerk.example.test/oauth/device_authorization");
      assert.equal(authorization.params.get("client_id"), "oauth_client_test");
      assert.equal(authorization.params.get("scope"), "openid profile email offline_access");

      const polls = tokenRequests(server.requests);
      assert.lengthOf(polls, 2);
      for (const poll of polls) {
        assert.equal(poll.url, "https://clerk.example.test/oauth/token");
        assert.equal(poll.params.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
        assert.equal(poll.params.get("device_code"), "device-code-1");
        assert.equal(poll.params.get("client_id"), "oauth_client_test");
      }
    }),
  );

  it.effect("waits the advertised interval between polls and backs off on slow_down", () =>
    Effect.gen(function* () {
      const server: DeviceFlowServer = {
        requests: [],
        tokenReplies: [oauthError("slow_down"), oauthError("authorization_pending")],
      };

      const fiber = yield* CliTokenManager.deviceAuthorizationLogin(() => Effect.void).pipe(
        Effect.provide(makeDeviceFlowLayer(server)),
        provideTestEnv,
        Effect.forkChild,
      );

      yield* TestClock.adjust(Duration.seconds(4));
      assert.lengthOf(tokenRequests(server.requests), 0);
      yield* TestClock.adjust(Duration.seconds(1));
      assert.lengthOf(tokenRequests(server.requests), 1);
      // slow_down widens the 5s interval to 10s.
      yield* TestClock.adjust(Duration.seconds(9));
      assert.lengthOf(tokenRequests(server.requests), 1);
      yield* TestClock.adjust(Duration.seconds(1));
      assert.lengthOf(tokenRequests(server.requests), 2);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("backs off after a transient upstream failure and keeps polling", () =>
    Effect.gen(function* () {
      const server: DeviceFlowServer = {
        requests: [],
        tokenReplies: [{ status: 503, body: "upstream unavailable" }, tokenGranted],
      };

      const fiber = yield* CliTokenManager.deviceAuthorizationLogin(() => Effect.void).pipe(
        Effect.provide(makeDeviceFlowLayer(server)),
        provideTestEnv,
        Effect.forkChild,
      );

      yield* TestClock.adjust(Duration.seconds(5));
      assert.lengthOf(tokenRequests(server.requests), 1);
      // The 5xx widens the 5s interval to 10s before the retry.
      yield* TestClock.adjust(Duration.seconds(9));
      assert.lengthOf(tokenRequests(server.requests), 1);
      yield* TestClock.adjust(Duration.seconds(1));
      const { token } = yield* Fiber.join(fiber);
      assert.lengthOf(tokenRequests(server.requests), 2);
      assert.equal(token.accessToken, "access-token-1");
    }),
  );

  it.effect("fails with a denied error when the user rejects the request", () =>
    Effect.gen(function* () {
      const server: DeviceFlowServer = {
        requests: [],
        tokenReplies: [oauthError("access_denied")],
      };

      const fiber = yield* CliTokenManager.deviceAuthorizationLogin(() => Effect.void).pipe(
        Effect.provide(makeDeviceFlowLayer(server)),
        provideTestEnv,
        Effect.flip,
        Effect.forkChild,
      );
      yield* TestClock.adjust(Duration.seconds(5));
      const result = yield* Fiber.join(fiber);

      assert.instanceOf(result, CliTokenManager.CloudCliAuthorizationDeniedError);
      assert.lengthOf(tokenRequests(server.requests), 1);
    }),
  );

  it.effect("times out once the device code lifetime elapses", () =>
    Effect.gen(function* () {
      const server: DeviceFlowServer = {
        requests: [],
        tokenReplies: [oauthError("authorization_pending")],
      };

      const fiber = yield* CliTokenManager.deviceAuthorizationLogin(() => Effect.void).pipe(
        Effect.provide(makeDeviceFlowLayer(server)),
        provideTestEnv,
        Effect.flip,
        Effect.forkChild,
      );
      yield* TestClock.adjust(Duration.seconds(600));
      const result = yield* Fiber.join(fiber);

      assert.instanceOf(result, CliTokenManager.CloudCliAuthorizationTimeoutError);
    }),
  );

  it.effect("surfaces other OAuth errors as authorization failures", () =>
    Effect.gen(function* () {
      const server: DeviceFlowServer = {
        requests: [],
        tokenReplies: [oauthError("invalid_client")],
      };

      const fiber = yield* CliTokenManager.deviceAuthorizationLogin(() => Effect.void).pipe(
        Effect.provide(makeDeviceFlowLayer(server)),
        provideTestEnv,
        Effect.flip,
        Effect.forkChild,
      );
      yield* TestClock.adjust(Duration.seconds(5));
      const result = yield* Fiber.join(fiber);

      assert.isTrue(isAuthorizationError(result));
    }),
  );
});

it.effect(
  "clear waits for an in-flight credential refresh instead of letting it resurrect the credential",
  () =>
    Effect.gen(function* () {
      // In-memory secret store standing in for the file-backed ServerSecretStore.
      const secrets = new Map<string, Uint8Array>();
      const secretsLayer = Layer.succeed(ServerSecretStore.ServerSecretStore, {
        get: (name) =>
          Effect.sync(() => {
            const value = secrets.get(name);
            return value === undefined ? Option.none<Uint8Array>() : Option.some(value);
          }),
        set: (name, value) =>
          Effect.sync(() => {
            secrets.set(name, value);
          }),
        create: (name, value) =>
          Effect.sync(() => {
            secrets.set(name, value);
          }),
        getOrCreateRandom: (name, bytes) =>
          Effect.sync(() => {
            const existing = secrets.get(name);
            if (existing !== undefined) return existing;
            const fresh = new Uint8Array(bytes);
            secrets.set(name, fresh);
            return fresh;
          }),
        remove: (name) =>
          Effect.gen(function* () {
            secrets.delete(name);
            yield* Deferred.succeed(removeExecuted, undefined);
          }),
      });

      // Gate the Clerk refresh_token exchange on Deferreds: the exchange
      // signals when it is in-flight, then waits for the test to release it.
      // This injects the exact interleaving deterministically — no sleeps.
      const refreshStarted = yield* Deferred.make<void>();
      const releaseRefresh = yield* Deferred.make<void>();
      // Fires when the secret store's remove actually executes, so the test
      // can tell whether clear ran while the refresh was still in-flight.
      const removeExecuted = yield* Deferred.make<void>();
      const refreshLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.gen(function* () {
            const body =
              request.body._tag === "Uint8Array"
                ? new TextDecoder().decode(request.body.body)
                : "";
            const params = new URLSearchParams(body);
            if (
              request.url.endsWith("/oauth/token") &&
              params.get("grant_type") === "refresh_token"
            ) {
              yield* Deferred.succeed(refreshStarted, undefined);
              yield* Deferred.await(releaseRefresh);
            }
            return HttpClientResponse.fromWeb(
              request,
              new Response(tokenGranted.body, {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
            );
          }),
        ),
      );

      const queue = yield* Queue.make<Terminal.UserInput>();
      const testCrypto = Crypto.make({
        randomBytes: (size) => new Uint8Array(size).fill(7),
        digest: (_algorithm, data) => Effect.succeed(data),
      });

      const manager = yield* CliTokenManager.make.pipe(
        Effect.provide(refreshLayer),
        Effect.provide(secretsLayer),
        Effect.provide(Layer.succeed(Terminal.Terminal, makeTestTerminal(queue))),
        Effect.provide(
          Layer.succeed(ExternalLauncher.ExternalLauncher, {
            resolveAvailableEditors: () => Effect.succeed([]),
            resolveFileManagerRevealKind: () => Effect.succeed(undefined),
            launchBrowser: () => Effect.void,
            launchEditor: () => Effect.void,
          }),
        ),
        Effect.provideService(Crypto.Crypto, testCrypto),
      );

      // Seed an expired credential so getExisting takes the refresh path and
      // holds the credential semaphore across the token exchange.
      yield* manager.store({
        accessToken: "expired-access-token",
        refreshToken: "refresh-token-1",
        expiresAtEpochMs: 0,
        identity: "theo@example.test",
      });
      assert.isTrue(yield* manager.hasCredential);

      // Start the refresh; it holds the semaphore while the exchange is in-flight.
      const refreshFiber = yield* Effect.forkChild(manager.getExisting);
      yield* Deferred.await(refreshStarted);

      // The user signs out while the refresh is in-flight.
      const clearFiber = yield* Effect.forkChild(manager.clear);
      // Let the clear fiber run if it isn't blocked on the credential gate.
      // The refresh fiber is suspended on releaseRefresh, so on a correct
      // implementation the clear fiber must be stuck on the semaphore here.
      yield* Effect.yieldNow;
      const clearBypassedGate = yield* Deferred.isDone(removeExecuted);

      yield* Deferred.succeed(releaseRefresh, undefined);
      yield* Fiber.join(refreshFiber);
      yield* Fiber.join(clearFiber);

      // The sign-out must go through the same credential gate as every other
      // op: it must not remove the credential while a refresh is in-flight
      // and let the refresh's persist resurrect it afterwards.
      assert.isFalse(clearBypassedGate);
      assert.isFalse(yield* manager.hasCredential);
    }).pipe(
      // cloudCliOAuthConfig is read when the manager ops execute, not when
      // the manager is built, so the ConfigProvider must cover the whole test.
      provideTestEnv,
    ),
);
