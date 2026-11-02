import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

// Experimental, default off. With 4 KiB pages most event rows (1–3 KiB) sit one per leaf page,
// leaving about a fifth of the file unused. New databases and `t3 doctor --fix` use this size instead.
const EXPERIMENTAL_PAGE_SIZE_FLAG = "T3CODE_EXPERIMENTAL_PAGE_SIZE";

const isValidPageSize = (size: number) =>
  Number.isInteger(size) && size >= 512 && size <= 65_536 && (size & (size - 1)) === 0;

/** The opted-in SQLite page size, or undefined when the flag is unset or not a valid page size. */
export const experimentalPageSize: Effect.Effect<number | undefined> = Config.Int(
  EXPERIMENTAL_PAGE_SIZE_FLAG,
).pipe(
  Config.option,
  Config.map((size) => Option.getOrUndefined(Option.filter(size, isValidPageSize))),
  Effect.orElseSucceed(() => undefined),
);
