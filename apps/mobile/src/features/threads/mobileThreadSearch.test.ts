import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { scopedProjectKey } from "../../lib/scopedEntities";
import { makeThreadShellFixture } from "../../test-fixtures";
import { rankMobileThreadMatches, type MobileThreadSearchFields } from "./mobileThreadSearch";
import { buildThreadListV2Items } from "./threadListV2";

interface Candidate extends MobileThreadSearchFields {
  readonly id: string;
}

function rankedIds(items: ReadonlyArray<Candidate>, query: string): string[] {
  return rankMobileThreadMatches(items, query, (item) => item).map(({ item }) => item.id);
}

describe("mobile thread fuzzy search", () => {
  it("tolerates one insertion, deletion, substitution, or adjacent swap", () => {
    const items = [
      { id: "search", title: "Search" },
      { id: "unrelated", title: "Compile" },
    ];
    expect(rankedIds(items, "serach")).toEqual(["search"]);
    expect(rankedIds(items, "searxh")).toEqual(["search"]);
    expect(rankedIds(items, "searxch")).toEqual(["search"]);
    expect(rankedIds(items, "sarch")).toEqual(["search"]);
    expect(rankedIds([{ id: "short", title: "cat" }], "cot")).toEqual([]);
  });

  it("matches an in-order subsequence within a word", () => {
    expect(rankedIds([{ id: "search", title: "Search history" }], "srch")).toEqual(["search"]);
  });

  it("folds case and accents in queries and fields", () => {
    expect(rankedIds([{ id: "accent", title: "Café résumé" }], "CAFE RESUME")).toEqual([
      "accent",
    ]);
    expect(rankedIds([{ id: "accent", title: "Cafe" }], "CAFÉ")).toEqual(["accent"]);
  });

  it("matches word prefixes in titles and branch paths", () => {
    expect(
      rankedIds(
        [
          { id: "title", title: "Navigation drawer" },
          { id: "branch", title: "Unrelated", branch: "feature/navigation" },
        ],
        "nav",
      ),
    ).toEqual(["title", "branch"]);
  });

  it("ranks titles before projects and branches, and messages last", () => {
    const items: Candidate[] = [
      {
        id: "message",
        title: "Unrelated",
        messageMatched: true,
        activityAt: "2026-06-04T00:00:00.000Z",
      },
      {
        id: "branch",
        title: "Unrelated",
        branch: "feature/search",
        activityAt: "2026-06-03T00:00:00.000Z",
      },
      {
        id: "project",
        title: "Unrelated",
        project: "Search",
        activityAt: "2026-06-02T00:00:00.000Z",
      },
      {
        id: "title",
        title: "Search",
        activityAt: "2026-06-01T00:00:00.000Z",
      },
    ];
    expect(rankedIds(items, "search")).toEqual(["title", "project", "branch", "message"]);
  });

  it("ranks equal-quality hits by most recent activity", () => {
    expect(
      rankedIds(
        [
          { id: "older", title: "Search alerts", activityAt: "2026-01-01T00:00:00.000Z" },
          { id: "newer", title: "Search alerts", activityAt: "2026-06-01T00:00:00.000Z" },
        ],
        "search",
      ),
    ).toEqual(["newer", "older"]);
  });

  it("keeps the caller's exact order when the query is empty", () => {
    const items: Candidate[] = [
      { id: "pinned", title: "Pinned", activityAt: "2026-01-01T00:00:00.000Z" },
      { id: "latest", title: "Latest", activityAt: "2026-06-01T00:00:00.000Z" },
    ];
    const ranked = rankMobileThreadMatches(items, "  ", (item) => item);
    expect(ranked.map(({ item }) => item)).toEqual(items);
    expect(ranked[0]?.item).toBe(items[0]);
  });
});

describe("active mobile thread search integration", () => {
  const environmentId = EnvironmentId.make("environment-fuzzy");
  const key = (id: string) =>
    threadSearchMatchKey({ environmentId, threadId: ThreadId.make(id) });
  const makeThread = (
    id: string,
    title: string,
    projectId: string,
    overrides: Partial<EnvironmentThreadShell> = {},
  ) =>
    makeThreadShellFixture({
      environmentId,
      id: ThreadId.make(id),
      projectId: ProjectId.make(projectId),
      title,
      ...overrides,
    });

  it("uses the shared ranking and marks only preview-only results as content-only", () => {
    const threads = [
      makeThread("message", "Other work", "project-other", {
        updatedAt: "2026-06-04T00:00:00.000Z",
      }),
      makeThread("branch", "Other work", "project-other", {
        branch: "feature/search",
        updatedAt: "2026-06-03T00:00:00.000Z",
      }),
      makeThread("project", "Other work", "project-search", {
        updatedAt: "2026-06-02T00:00:00.000Z",
      }),
      makeThread("title", "Search", "project-other", {
        updatedAt: "2026-06-01T00:00:00.000Z",
      }),
    ];
    const layout = buildThreadListV2Items({
      threads,
      environmentId: null,
      searchQuery: "search",
      projectTitles: new Map([
        [scopedProjectKey(environmentId, ProjectId.make("project-search")), "Search"],
      ]),
      matchedThreadKeys: new Set([key("message")]),
      now: "2026-06-04T00:00:00.000Z",
    });

    expect(layout.items.map(({ thread }) => thread.id)).toEqual([
      "title",
      "project",
      "branch",
      "message",
    ]);
    expect([...layout.contentOnlyThreadKeys]).toEqual([key("message")]);
  });
});
