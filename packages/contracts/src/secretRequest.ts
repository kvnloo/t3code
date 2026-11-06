import * as Schema from "effect/Schema";

import { SecretRef, ThreadId, TrimmedNonEmptyString, TurnItemId } from "./baseSchemas.ts";

export const SecretRequestReopenInput = Schema.Struct({
  threadId: ThreadId,
  turnItemId: TurnItemId,
});
export type SecretRequestReopenInput = typeof SecretRequestReopenInput.Type;

export const SecretRequestReopenResult = Schema.Union([
  Schema.Struct({ state: Schema.Literal("pending"), turnItemId: TurnItemId }),
  Schema.Struct({ state: Schema.Literal("ended"), turnItemId: TurnItemId }),
  Schema.Struct({
    state: Schema.Literal("saved"),
    turnItemId: TurnItemId,
    delivery: Schema.Union([
      Schema.Struct({ type: Schema.Literal("ref"), ref: SecretRef }),
      Schema.Struct({ type: Schema.Literal("file"), path: TrimmedNonEmptyString }),
    ]),
  }),
]);
export type SecretRequestReopenResult = typeof SecretRequestReopenResult.Type;

/** Server stores the value under a one-use SecretRef; the thread learns only status. */
export const SecretRequestAnswerInput = Schema.Struct({
  threadId: ThreadId,
  turnItemId: TurnItemId,
  answer: Schema.Union([
    Schema.Struct({ type: Schema.Literal("save"), secret: TrimmedNonEmptyString }),
    Schema.Struct({ type: Schema.Literal("decline") }),
  ]),
});
export type SecretRequestAnswerInput = typeof SecretRequestAnswerInput.Type;

const SECRET_REQUEST_FAILURE_MESSAGES = {
  load_failed: "Could not load the secret request.",
  not_found: "This secret request no longer exists.",
  already_answered: "This secret request was already answered.",
  not_reopenable: "This secret request is still open. Answer the existing prompt.",
  agent_stopped: "The agent that asked has stopped, so this secret can't be used.",
  store_failed: "Could not store the secret.",
  record_failed: "Saved the secret, but could not update the request.",
  invalid_ref: "That secretRef is not valid.",
  read_failed: "Could not read the secret.",
  ref_unavailable:
    "That secretRef was already used or does not exist. Ask the user again with request_secret.",
  ref_expired: "That secretRef expired. Ask the user again with request_secret.",
  consume_failed: "Could not use that secretRef. Try again.",
  not_a_file_request:
    'The user did not save this secret for shell use. Ask again with request_secret and delivery: "file".',
} as const;

export const SecretRequestFailureReason = Schema.Literals(
  Object.keys(SECRET_REQUEST_FAILURE_MESSAGES) as Array<
    keyof typeof SECRET_REQUEST_FAILURE_MESSAGES
  >,
);
export type SecretRequestFailureReason = typeof SecretRequestFailureReason.Type;

export class SecretRequestError extends Schema.TaggedError<SecretRequestError>()(
  "SecretRequestError",
  {
    reason: SecretRequestFailureReason,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return SECRET_REQUEST_FAILURE_MESSAGES[this.reason];
  }
}
