import * as Schema from "effect/Schema";

import {
  CommandId,
  IsoDateTime,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ThreadLinkedPullRequest } from "./threadPullRequest.ts";
import { ThreadTag } from "./threadTags.ts";
import { ThreadTitleRegeneration } from "./threadTitle.ts";

export function hasOnlyPairedSurrogates(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

const ThreadMetadataTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(512)).annotate({
  description: "New concise display title. Required only when action is rename.",
});

const ThreadMetadataClientRequestId = TrimmedNonEmptyString.check(Schema.isMaxLength(256))
  .check(
    Schema.makeFilter((value) =>
      hasOnlyPairedSurrogates(value)
        ? true
        : "clientRequestId must contain valid paired Unicode surrogates.",
    ),
  )
  .annotate({ description: "Stable idempotency key to reuse when retrying this mutation." });

export const ThreadMetadataMcpAction = Schema.Literals([
  "rename",
  "regenerate_title",
  "tag",
  "untag",
]);
export type ThreadMetadataMcpAction = typeof ThreadMetadataMcpAction.Type;

const ThreadMetadataTag = ThreadTag.annotate({
  description:
    "Tag to add or remove. Required only when action is tag or untag. Tags with a style in settings show as an icon or chip in thread lists.",
});

export const ThreadMetadataMcpUpdateInput = Schema.Struct({
  threadId: Schema.optional(ThreadId),
  action: ThreadMetadataMcpAction,
  title: Schema.optional(ThreadMetadataTitle),
  tag: Schema.optional(ThreadMetadataTag),
  clientRequestId: Schema.optional(ThreadMetadataClientRequestId),
}).check(
  Schema.makeFilter((input) =>
    (input.action === "rename") === (input.title !== undefined)
      ? true
      : "rename requires title; other actions do not accept one.",
  ),
  Schema.makeFilter((input) =>
    (input.action === "tag" || input.action === "untag") === (input.tag !== undefined)
      ? true
      : "tag and untag require tag; other actions do not accept one.",
  ),
);
export type ThreadMetadataMcpUpdateInput = typeof ThreadMetadataMcpUpdateInput.Type;

export const ThreadMetadataMcpUpdateResult = Schema.Struct({
  threadId: ThreadId,
  action: ThreadMetadataMcpAction,
  commandId: CommandId,
  sequence: NonNegativeInt,
  title: Schema.String,
  tags: Schema.Array(Schema.String),
  titleRegeneration: Schema.NullOr(ThreadTitleRegeneration),
  linkedPullRequest: Schema.NullOr(ThreadLinkedPullRequest),
  updatedAt: IsoDateTime,
});
export type ThreadMetadataMcpUpdateResult = typeof ThreadMetadataMcpUpdateResult.Type;
