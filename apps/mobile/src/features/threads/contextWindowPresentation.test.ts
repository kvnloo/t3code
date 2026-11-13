import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import {
  NodeId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  TurnItemId,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderTurn,
} from "@t3tools/contracts";
import { deriveLatestContextWindowSnapshot } from "@t3tools/client-runtime/context-window";
import { v2Projection } from "../../../../../packages/client-runtime/src/state/orchestrationV2TestFixtures";
import { contextWindowPresentation, deriveComposerContextWindow } from "./contextWindowPresentation";

const selection = v2Projection.thread.modelSelection;
const updatedAt = "2026-10-30T12:00:00.000Z";

function projection() {
  const providerThread: OrchestrationV2ProviderThread = {
    id: ProviderThreadId.make("active"),
    driver: ProviderDriverKind.make("codex"),
    providerInstanceId: selection.instanceId,
    providerSessionId: null,
    appThreadId: v2Projection.thread.id,
    ownerNodeId: null,
    nativeThreadRef: null,
    nativeConversationHeadRef: null,
    status: "idle",
    firstRunOrdinal: null,
    lastRunOrdinal: null,
    handoffIds: [],
    forkedFrom: null,
    pendingBackgroundTasks: [],
    contextUsage: { usedTokens: 20_000, maxTokens: 100_000, totalProcessedTokens: 999_999 },
    nativeMetadata: { modelSelection: selection },
    goal: null,
    createdAt: DateTime.makeUnsafe(updatedAt),
    updatedAt: DateTime.makeUnsafe(updatedAt),
  };
  const turn: OrchestrationV2ProviderTurn = {
    id: ProviderTurnId.make("turn"),
    providerThreadId: providerThread.id,
    nodeId: NodeId.make("node"),
    runAttemptId: null,
    nativeTurnRef: null,
    ordinal: 1,
    status: "completed",
    tokenUsage: { usedTokens: 42_000, maxTokens: 200_000, updatedAt },
    startedAt: null,
    completedAt: null,
  };
  return {
    ...v2Projection,
    thread: { ...v2Projection.thread, activeProviderThreadId: providerThread.id },
    providerThreads: [providerThread],
    providerTurns: [turn],
  };
}

describe("Android composer context window", () => {
  it.each([
    [42_000, 200_000, "Context 42k / 200k · 21%"],
    [0, 200_000, "Context 0 / 200k · 0%"],
    [250_000, 200_000, "Context 250k / 200k · 125%"],
    [42_000, undefined, "Context 42k / unavailable"],
    [42_000, null, "Context 42k / unavailable"],
    [42_000, 0, "Context 42k / unavailable"],
  ])("presents %d used / %s capacity honestly", (usedTokens, maxTokens, label) => {
    const snapshot = deriveLatestContextWindowSnapshot([], { usedTokens, maxTokens, updatedAt });
    expect(contextWindowPresentation(snapshot).label).toBe(label);
  });

  it("does not treat absent telemetry or capacity as zero", () => {
    expect(contextWindowPresentation(null).label).toBe("Context unavailable");
    const snapshot = deriveLatestContextWindowSnapshot([], { usedTokens: 0, updatedAt });
    expect(contextWindowPresentation(snapshot).accessibilityLabel).toContain(
      "Capacity and percentage unavailable",
    );
  });

  it("uses normalized occupancy, updates with turns and discards other provider threads", () => {
    const initial = projection();
    expect(deriveComposerContextWindow(initial, selection)?.usedTokens).toBe(42_000);
    const turn = initial.providerTurns[0]!;
    const next = {
      ...initial,
      providerTurns: [
        {
          ...turn,
          tokenUsage: {
            usedTokens: 50_000,
            maxTokens: 200_000,
            updatedAt: "2026-10-30T12:01:00.000Z",
          },
        },
        {
          ...turn,
          providerThreadId: ProviderThreadId.make("previous"),
          tokenUsage: { usedTokens: 999_999, updatedAt: "2026-10-30T12:02:00.000Z" },
        },
      ],
    };
    expect(deriveComposerContextWindow(next, selection)?.usedTokens).toBe(50_000);
    expect(
      deriveComposerContextWindow({ ...initial, providerTurns: [] }, selection)?.usedTokens,
    ).toBe(20_000);
  });

  it("clears usage for missing detail, changed model or provider, and missing active context", () => {
    const initial = projection();
    expect(deriveComposerContextWindow(null, selection)).toBeNull();
    expect(deriveComposerContextWindow(initial, { ...selection, model: "different" })).toBeNull();
    expect(
      deriveComposerContextWindow(initial, {
        ...selection,
        instanceId: ProviderInstanceId.make("different"),
      }),
    ).toBeNull();
    expect(
      deriveComposerContextWindow(
        { ...initial, thread: { ...initial.thread, activeProviderThreadId: null } },
        selection,
      ),
    ).toBeNull();
    expect(
      deriveComposerContextWindow(
        {
          ...initial,
          thread: { ...initial.thread, modelSelection: { ...selection, model: "different" } },
        },
        { ...selection, model: "different" },
      ),
    ).toBeNull();
  });

  it("shows post-compaction occupancy rather than an older turn's capacity", () => {
    const initial = projection();
    const item = {
      id: TurnItemId.make("compaction"),
      threadId: initial.thread.id,
      runId: null,
      nodeId: null,
      providerThreadId: initial.thread.activeProviderThreadId,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 2,
      status: "completed" as const,
      title: null,
      startedAt: null,
      completedAt: null,
      updatedAt: DateTime.makeUnsafe("2026-10-30T12:02:00.000Z"),
      type: "compaction" as const,
      driver: null,
      beforeTokenCount: 42_000,
      afterTokenCount: 2_000,
    };
    const snapshot = deriveComposerContextWindow(
      {
        ...initial,
        visibleTurnItems: [{
          item,
          sourceThreadId: initial.thread.id,
          sourceItemId: item.id,
          position: 0,
          visibility: "local",
        }],
      },
      selection,
    );
    expect(snapshot?.usedTokens).toBe(2_000);
    expect(contextWindowPresentation(snapshot).label).toBe("Context 2k / unavailable");
  });
});
