export interface MobileThreadSearchFields {
  readonly title: string;
  readonly project?: string | null;
  readonly branch?: string | null;
  readonly workspaceRoot?: string | null;
  readonly environmentLabel?: string | null;
  readonly messagePreview?: string | null;
  readonly messageMatched?: boolean;
  readonly activityAt?: string | null;
}

export interface RankedMobileThread<T> {
  readonly item: T;
  readonly tier: "title" | "context" | "message";
  readonly quality: number;
  readonly activityAt: number;
}

const WORDS = /[\p{L}\p{N}]+/gu;
const MARKS = /\p{M}/gu;

function fold(value: string): string {
  return value.normalize("NFKD").replace(MARKS, "").toLowerCase();
}

function words(value: string): ReadonlyArray<string> {
  return fold(value).match(WORDS) ?? [];
}

function oneEdit(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  if (left === right) return true;
  if (left.length === right.length) {
    const differences: number[] = [];
    for (let index = 0; index < left.length; index++) {
      if (left[index] !== right[index]) differences.push(index);
      if (differences.length > 2) return false;
    }
    if (differences.length === 1) return true;
    if (differences.length !== 2 || differences[1] !== differences[0]! + 1) return false;
    const at = differences[0]!;
    return left[at] === right[at + 1] && left[at + 1] === right[at];
  }
  const longer = left.length > right.length ? left : right;
  const shorter = left.length > right.length ? right : left;
  let skipped = false;
  for (let i = 0, j = 0; i < longer.length; i++) {
    if (longer[i] === shorter[j]) {
      j++;
    } else if (skipped) {
      return false;
    } else {
      skipped = true;
    }
  }
  return true;
}

function subsequence(query: string, value: string): boolean {
  let at = 0;
  for (const character of value) {
    if (character === query[at]) at++;
    if (at === query.length) return true;
  }
  return false;
}

function wordQuality(query: string, value: string): number {
  if (query === value) return 4;
  if (value.startsWith(query)) return 3;
  if (
    query.length >= 4 &&
    (oneEdit(query, value) ||
      oneEdit(query, value.slice(0, query.length)) ||
      oneEdit(query, value.slice(0, query.length + 1)))
  ) {
    return 2;
  }
  return query.length >= 3 && subsequence(query, value) ? 1 : 0;
}

function fieldQuality(field: string | null | undefined, terms: ReadonlyArray<string>): number {
  if (!field) return 0;
  const tokens = words(field);
  if (tokens.length === 0) return 0;
  const joined = tokens.join("");
  let total = 0;
  for (const term of terms) {
    let best = 0;
    for (const token of tokens) best = Math.max(best, wordQuality(term, token));
    if (best === 0 && term.length >= 3 && subsequence(term, joined)) best = 0.75;
    if (best === 0) return 0;
    total += best;
  }
  return total / terms.length + (joined === terms.join("") ? 0.5 : 0);
}

function matchQuality(
  fields: MobileThreadSearchFields,
  terms: ReadonlyArray<string>,
): Pick<RankedMobileThread<unknown>, "tier" | "quality"> | null {
  const title = fieldQuality(fields.title, terms);
  if (title > 0) return { tier: "title", quality: title };

  const context = [fields.project, fields.branch, fields.workspaceRoot, fields.environmentLabel];
  const contextQuality = Math.max(...context.map((field) => fieldQuality(field, terms)));
  if (contextQuality > 0) return { tier: "context", quality: contextQuality };

  const allFields = [fields.title, ...context].filter((field): field is string => !!field);
  const separate = terms.map((term) =>
    Math.max(...allFields.map((field) => fieldQuality(field, [term])), 0),
  );
  if (separate.every((quality) => quality > 0)) {
    return {
      tier: "context",
      quality: separate.reduce((total, quality) => total + quality, 0) / separate.length / 2,
    };
  }

  const preview = fieldQuality(fields.messagePreview, terms);
  if (preview > 0 || fields.messageMatched) {
    return { tier: "message", quality: preview };
  }
  return null;
}

/**
 * One ranking for active, archived, and pending mobile threads.
 * Empty searches preserve the caller's order, including pinned and archive sorting.
 */
export function rankMobileThreadMatches<T>(
  items: ReadonlyArray<T>,
  query: string,
  fieldsOf: (item: T) => MobileThreadSearchFields,
): ReadonlyArray<RankedMobileThread<T>> {
  const terms = words(query);
  if (terms.length === 0) {
    return items.map((item) => ({
      item,
      tier: "title" as const,
      quality: 0,
      activityAt: 0,
    }));
  }

  const ranked: Array<RankedMobileThread<T> & { readonly index: number }> = [];
  items.forEach((item, index) => {
    const fields = fieldsOf(item);
    const match = matchQuality(fields, terms);
    if (match === null) return;
    const activityAt = Date.parse(fields.activityAt ?? "");
    ranked.push({
      item,
      ...match,
      activityAt: Number.isNaN(activityAt) ? 0 : activityAt,
      index,
    });
  });
  const tierRank = { title: 3, context: 2, message: 1 };
  return ranked
    .sort(
      (left, right) =>
        tierRank[right.tier] - tierRank[left.tier] ||
        right.quality - left.quality ||
        right.activityAt - left.activityAt ||
        left.index - right.index,
    )
    .map(({ item, tier, quality, activityAt }) => ({ item, tier, quality, activityAt }));
}
