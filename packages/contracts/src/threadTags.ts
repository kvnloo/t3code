import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Tags match by exact spelling and case after trimming. */
export const ThreadTag = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.makeFilter((value) =>
    /[\p{Cc}]/u.test(value) ? "A thread tag must be a single line of text." : true,
  ),
);
export type ThreadTag = typeof ThreadTag.Type;

/** Tags read back from storage or a peer. Lenient so a later tag rule never fails a whole thread. */
export const StoredThreadTags = Schema.Array(Schema.String).pipe(
  Schema.catchDecoding(() => Effect.succeedSome([])),
);

/** Icons a tag can show. Each client maps these names to its own icon set. */
export const THREAD_TAG_ICONS = [
  "flame",
  "star",
  "hand",
  "bolt",
  "alert",
  "check",
  "clock",
  "pause",
  "eye",
  "rocket",
  "bug",
  "flask",
  "sparkles",
  "brain",
  "chart",
  "code",
  "pull-request",
  "phone",
  "film",
  "palette",
  "book",
  "heart",
  "lock",
  "cloud",
] as const;
export const ThreadTagIcon = Schema.Literals(THREAD_TAG_ICONS);
export type ThreadTagIcon = typeof ThreadTagIcon.Type;

/** Named tints, so each theme and client picks its own shade. */
export const THREAD_TAG_COLORS = [
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
  "gray",
] as const;
export const ThreadTagColor = Schema.Literals(THREAD_TAG_COLORS);
export type ThreadTagColor = typeof ThreadTagColor.Type;

/** How a tag looks in thread lists. Tags without a style stay invisible there. */
export const ThreadTagStyle = Schema.Struct({
  tag: ThreadTag,
  icon: Schema.optionalKey(ThreadTagIcon),
  color: Schema.optionalKey(ThreadTagColor),
});
export type ThreadTagStyle = typeof ThreadTagStyle.Type;

const isThreadTagStyle = Schema.is(ThreadTagStyle);

/**
 * Styled tags in priority order: the first one with an icon leads a thread's row.
 * Bad or repeated entries drop alone, so a hand edit cannot reset settings.
 */
export const ThreadTagStyles = Schema.Array(Schema.Unknown).pipe(
  Schema.decodeTo(
    Schema.Array(ThreadTagStyle),
    SchemaTransformation.transform<ReadonlyArray<ThreadTagStyle>, ReadonlyArray<unknown>>({
      decode: (values) => {
        const seen = new Set<string>();
        return values.filter((value): value is ThreadTagStyle => {
          if (!isThreadTagStyle(value) || seen.has(value.tag)) return false;
          seen.add(value.tag);
          return true;
        });
      },
      encode: (values) => values,
    }),
  ),
);
