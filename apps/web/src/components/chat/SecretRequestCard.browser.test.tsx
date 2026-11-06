import { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import type { SecretRequestItem } from "@t3tools/client-runtime/secret-request";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ allowed: true, reopen: vi.fn(), answer: vi.fn() }));
vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: () => state.allowed,
}));
vi.mock(import("../../state/use-atom-command"), async () => {
  const { serverEnvironment } = await import("../../state/server");
  return {
    useAtomCommand: (command: unknown) =>
      command === serverEnvironment.reopenSecretRequest ? state.reopen : state.answer,
  };
});

import { render } from "../../../test/render";
import { SecretRequestCard } from "./SecretRequestCard";

const environmentId = EnvironmentId.make("r04-synthetic-environment");
const originalId = TurnItemId.make("r04-original");
const successorId = TurnItemId.make("r04-successor");
const item: SecretRequestItem = {
  id: originalId,
  threadId: ThreadId.make("r04-thread"),
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 1,
  status: "cancelled",
  title: "Synthetic token",
  startedAt: null,
  completedAt: DateTime.makeUnsafe(0),
  updatedAt: DateTime.makeUnsafe(0),
  type: "secret_request",
  label: "Synthetic token",
  reason: "Synthetic secure-input verification",
  secretStatus: "cancelled",
};

function setup() {
  state.allowed = true;
  state.reopen
    .mockReset()
    .mockResolvedValue({ _tag: "Success", value: { state: "pending", turnItemId: successorId } });
  state.answer.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
}

it("reopens from a user click and clears the secure input after saving the successor", async () => {
  setup();
  await using screen = await render(
    <SecretRequestCard environmentId={environmentId} item={item} visibility="local" />,
  );
  await screen.getByRole("button", { name: "Reopen secure prompt" }).click();
  expect(state.reopen).toHaveBeenCalledWith({
    environmentId,
    input: { threadId: item.threadId, turnItemId: originalId },
  });
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("The agent has not been resumed");

  await screen.rerender(
    <SecretRequestCard
      environmentId={environmentId}
      item={{
        ...item,
        id: successorId,
        parentItemId: originalId,
        secretStatus: "pending",
        status: "waiting",
      }}
      visibility="local"
    />,
  );
  await screen.getByRole("textbox", { name: item.label }).fill("r04-synthetic-secret");
  expect(screen.container.textContent).not.toContain("r04-synthetic-secret");
  await screen.getByRole("button", { name: "Save securely" }).click();
  expect(state.answer).toHaveBeenCalledWith({
    environmentId,
    input: {
      threadId: item.threadId,
      turnItemId: successorId,
      answer: { type: "save", secret: "r04-synthetic-secret" },
    },
  });
  await expect.element(screen.getByRole("textbox", { name: item.label })).toHaveValue("");
  expect(screen.container.textContent).not.toContain("r04-synthetic-secret");
  expect(state.reopen).toHaveBeenCalledOnce();
  state.reopen.mockResolvedValue({
    _tag: "Success",
    value: {
      state: "saved",
      turnItemId: successorId,
      delivery: { type: "ref", ref: "secret-ref:00000000000000000000000000000000" },
    },
  });
  await screen.rerender(
    <SecretRequestCard
      environmentId={environmentId}
      item={{
        ...item,
        id: successorId,
        parentItemId: originalId,
        secretStatus: "saved",
        status: "completed",
      }}
      visibility="local"
    />,
  );
  await screen.getByRole("button", { name: "Show secure reference" }).click();
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("secret-ref:00000000000000000000000000000000");
  expect(screen.container.textContent).not.toContain("r04-synthetic-secret");
  state.reopen.mockClear();
  await screen.getByRole("button", { name: "Reopen secure prompt" }).click();
  expect(state.reopen).toHaveBeenCalledWith({
    environmentId,
    input: { threadId: item.threadId, turnItemId: successorId },
  });
});

it("does not offer reopen in inherited or synthetic cards, or execute it without permission", async () => {
  setup();
  await using screen = await render(
    <SecretRequestCard environmentId={environmentId} item={item} visibility="inherited" />,
  );
  expect(screen.container.querySelector("button")).toBeNull();
  await screen.rerender(
    <SecretRequestCard environmentId={environmentId} item={item} visibility="synthetic" />,
  );
  expect(screen.container.querySelector("button")).toBeNull();
  state.allowed = false;
  await screen.rerender(
    <SecretRequestCard environmentId={environmentId} item={item} visibility="local" />,
  );
  await expect.element(screen.getByRole("button", { name: "Reopen secure prompt" })).toBeDisabled();
  expect(state.reopen).not.toHaveBeenCalled();
});

it("redacts an answer failure that contains the typed secret", async () => {
  setup();
  state.answer.mockResolvedValue(
    Effect.runSyncExit(Effect.fail(new Error("r04-synthetic-secret"))),
  );
  await using screen = await render(
    <SecretRequestCard
      environmentId={environmentId}
      item={{
        ...item,
        id: successorId,
        parentItemId: originalId,
        secretStatus: "pending",
        status: "waiting",
      }}
      visibility="local"
    />,
  );
  await screen.getByRole("textbox", { name: item.label }).fill("r04-synthetic-secret");
  await screen.getByRole("button", { name: "Save securely" }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Could not answer the request. Try again.");
  expect(screen.container.textContent).not.toContain("r04-synthetic-secret");
});
