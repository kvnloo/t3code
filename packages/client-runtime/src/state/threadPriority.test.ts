// @effect-diagnostics globalDate:off -- Fixture timestamps are plain ISO strings around a fixed clock.
import { EnvironmentId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  compareGroupPriority,
  scoreThreadPriority,
  sortThreadsByPriority,
  summarizeGroupPriority,
  type ThreadPriorityInput,
} from "./threadPriority.ts";

const environmentId = EnvironmentId.make("environment-1");
const NOW = Date.parse("2026-06-02T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function thread(id: string, overrides: Partial<ThreadPriorityInput> = {}) {
  return {
    id: ThreadId.make(id),
    environmentId,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    interactionMode: "default" as const,
    latestRun: null,
    runtime: null,
    latestUserMessageAt: null,
    goal: null,
    pullRequests: [],
    lastVisitedAt: minutesAgo(10_000),
    ...overrides,
  } satisfies ThreadPriorityInput & { id: string; environmentId: string };
}

function completedRun(completedMinutesAgo: number, status: "completed" | "failed" = "completed") {
  return {
    runId: RunId.make(`run-${completedMinutesAgo}`),
    status,
    requestedAt: minutesAgo(completedMinutesAgo + 5),
    startedAt: minutesAgo(completedMinutesAgo + 5),
    completedAt: minutesAgo(completedMinutesAgo),
    assistantMessageId: null,
  };
}

const running = {
  status: "running" as const,
  activeRunId: null,
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerName: "Codex",
  lastError: null,
  updatedAt: minutesAgo(1),
};

describe("scoreThreadPriority", () => {
  it("tiers threads by what they need from the user", () => {
    const tierOf = (input: Partial<ThreadPriorityInput>) =>
      scoreThreadPriority(thread("t", input), NOW).tier;
    expect(tierOf({ hasPendingApprovals: true })).toBe(1);
    expect(tierOf({ hasPendingUserInput: true })).toBe(1);
    expect(tierOf({ latestRun: completedRun(5, "failed") })).toBe(2);
    expect(tierOf({ latestRun: completedRun(5) })).toBe(2);
    expect(tierOf({ runtime: running })).toBe(3);
    expect(tierOf({ latestRun: completedRun(5), lastVisitedAt: minutesAgo(1) })).toBe(4);
  });

  it("keeps every tier above the one below it whatever the bonuses", () => {
    const loudReview = scoreThreadPriority(
      thread("review", {
        latestRun: completedRun(10_000, "failed"),
        latestUserMessageAt: minutesAgo(0),
        opens: { openedAt: NOW, score: 1_000, picks: [] },
        goal: { objective: "Ship", status: "active" },
      }),
      NOW,
    );
    const quietBlocker = scoreThreadPriority(thread("blocked", { hasPendingUserInput: true }), NOW);
    expect(loudReview.score).toBeLessThan(400);
    expect(quietBlocker.score).toBeGreaterThanOrEqual(400);
  });

  it("raises a request the longer it waits", () => {
    const fresh = scoreThreadPriority(thread("a", { latestRun: completedRun(2) }), NOW);
    const stale = scoreThreadPriority(thread("b", { latestRun: completedRun(6 * 60) }), NOW);
    expect(stale.score).toBeGreaterThan(fresh.score);
    expect(stale.reasons).toContain("Waiting 6h");
  });

  it("ranks a failing open PR as review work", () => {
    const priority = scoreThreadPriority(
      thread("pr", {
        lastVisitedAt: minutesAgo(1),
        latestRun: completedRun(30),
        pullRequests: [
          {
            host: "github.com",
            repository: "o/r",
            number: 1,
            url: "https://github.com/o/r/pull/1",
            source: "agent",
            linkedAt: minutesAgo(60),
            stack: null,
            snapshot: {
              state: "open",
              title: "Fix",
              headBranch: "fix",
              baseBranch: "main",
              isDraft: false,
              updatedAt: null,
              syncedAt: minutesAgo(1),
              checksState: "failing",
            },
          },
        ],
      }),
      NOW,
    );
    expect(priority.tier).toBe(2);
    expect(priority.reasons[0]).toBe("PR checks failing");
  });
});

describe("sortThreadsByPriority", () => {
  it("puts blocked threads first and quiet ones last", () => {
    const sorted = sortThreadsByPriority(
      [
        thread("quiet"),
        thread("working", { runtime: running }),
        thread("approval", { hasPendingApprovals: true }),
        thread("done", { latestRun: completedRun(20) }),
      ],
      NOW,
    );
    expect(sorted.map((entry) => entry.id)).toEqual(["approval", "done", "working", "quiet"]);
  });
});

describe("group priority", () => {
  it("orders groups by urgent tier, then by how many threads want the user", () => {
    const score = (input: Partial<ThreadPriorityInput>) =>
      scoreThreadPriority(thread("t", input), NOW);
    const oneBlocker = summarizeGroupPriority([score({ hasPendingApprovals: true }), score({})]);
    const twoReviews = summarizeGroupPriority([
      score({ latestRun: completedRun(5) }),
      score({ latestRun: completedRun(9, "failed") }),
    ]);
    const oneReview = summarizeGroupPriority([score({ latestRun: completedRun(5) })]);
    expect(oneBlocker).toMatchObject({ tier: 1, attentionCount: 1 });
    expect([oneReview, null, twoReviews, oneBlocker].toSorted(compareGroupPriority)).toEqual([
      oneBlocker,
      twoReviews,
      oneReview,
      null,
    ]);
  });
});
