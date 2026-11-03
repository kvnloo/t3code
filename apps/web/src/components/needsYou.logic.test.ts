import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, MessageId, PlanId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import {
  needsYouKey,
  needsYouQueue,
  needsYouReason,
  nextNeedsYouKey,
} from "@t3tools/client-runtime/state/needs-you";
import { makeThreadFixture } from "../test-fixtures";
import { decisionTimeline } from "./needsYou.logic";
import type { TimelineEntry } from "../session-logic";

const now = "2026-10-31T12:00:00.000Z";
function ready(id = "ready") {
  const thread = makeThreadFixture({ id: ThreadId.make(id) });
  return {
    ...thread,
    source: {
      ...thread.source,
      latestVisibleMessage: {
        id: MessageId.make("answer"),
        role: "assistant" as const,
        text: "Tests pass. Review the change.",
        updatedAt: DateTime.makeUnsafe(now),
      },
    },
  };
}

describe("Needs you queue", () => {
  it("shows requests while working, and keeps deferred, settled, archived and untouched work out", () => {
    const thread = ready();
    expect(needsYouReason(thread, now)).toBe("Ready for review");
    expect(needsYouReason(makeThreadFixture(), now)).toBeNull();
    expect(needsYouReason({ ...thread, settledOverride: "settled" }, now)).toBeNull();
    expect(
      needsYouReason({ ...thread, archivedAt: now, hasPendingApprovals: true }, now),
    ).toBeNull();
    expect(
      needsYouReason({ ...thread, snoozedUntil: "2026-11-01T00:00:00Z", snoozedAt: now }, now),
    ).toBeNull();
    const running = {
      ...thread,
      runtime: {
        status: "running" as const,
        activeRunId: null,
        providerInstanceId: thread.providerInstanceId,
        providerName: "Codex",
        lastError: null,
        updatedAt: now,
      },
    };
    expect(needsYouReason(running, now)).toBeNull();
    expect(needsYouReason({ ...running, hasPendingUserInput: true }, now)).toBe(
      "Your input needed",
    );
    expect(needsYouReason({ ...running, hasPendingApprovals: true }, now)).toBe("Approval needed");
  });

  it("ranks requests before results, respects pins and keeps identical ids across environments distinct", () => {
    const result = ready("same");
    const request = {
      ...ready("same"),
      environmentId: EnvironmentId.make("other"),
      hasPendingApprovals: true,
    };
    expect(needsYouQueue([result, request], now).map((entry) => entry.key)).toEqual([
      needsYouKey(request),
      needsYouKey(result),
    ]);
    expect(
      needsYouQueue([{ ...result, pinnedAt: now }, request], now)[0]?.thread.environmentId,
    ).toBe(result.environmentId);
  });

  it("does not steal selection on new arrivals, advances in the filtered queue and ends empty", () => {
    expect(nextNeedsYouKey(["new", "a", "b"], "a", ["a", "b"])).toBe("a");
    expect(nextNeedsYouKey(["a", "c"], "b", ["a", "b", "c"])).toBe("c");
    expect(nextNeedsYouKey(["a"], "b", ["a", "b"])).toBe("a");
    expect(nextNeedsYouKey([], "b", ["b"])).toBeNull();
  });
});

describe("decision-first history", () => {
  it("keeps the latest answer and this turn's artifacts, not old tools or plans", () => {
    const message = (id: string, role: "assistant" | "user"): TimelineEntry => ({
      id,
      kind: "message",
      createdAt: now,
      message: {
        id: MessageId.make(id),
        role,
        text: id,
        createdAt: now,
        updatedAt: now,
        streaming: false,
        runId: null,
        attachments: [],
      },
    });
    const plan = (id: string): TimelineEntry => ({
      id,
      kind: "proposed-plan",
      createdAt: now,
      proposedPlan: {
        id: PlanId.make(id),
        runId: null,
        planMarkdown: id,
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    });
    const entries: TimelineEntry[] = [
      message("old", "assistant"),
      plan("old plan"),
      message("ask", "user"),
      message("progress", "assistant"),
      message("answer", "assistant"),
      plan("new plan"),
    ];
    expect(decisionTimeline(entries).map((entry) => entry.id)).toEqual(["answer", "new plan"]);
    expect(
      decisionTimeline([message("old", "assistant"), message("new question", "user")]),
    ).toEqual([]);
    expect(decisionTimeline([])).toEqual([]);
  });
});
