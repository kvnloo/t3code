import type { ScopedThreadRef } from "@t3tools/contracts";
import { type ComponentProps, useLayoutEffect, useState } from "react";
import { useIncrementalTimelineEntries } from "../../hooks/useIncrementalTimelineEntries";
import type { TimelineEntriesInput, TimelineEntry } from "../../session-logic";
import { useThreadVisibleTurnItems } from "../../state/entities";
import {
  peekRememberedThreadTimeline,
  rememberReadyThreadTimeline,
  resolveThreadSwitchTimeline,
  timelineHasEphemeralPreviewUrls,
} from "../ChatView.logic";
import { MessagesTimeline } from "./MessagesTimeline";
import { decisionTimeline } from "../needsYou.logic";
import { Button } from "../ui/button";

/**
 * The timeline with the streamed text. ChatView reads the thread through its quiet
 * atoms, which hold through text deltas; this reads the live turn items, so a
 * delta re-renders the timeline without re-rendering ChatView.
 */
export function ThreadTimeline({
  threadDetailRef,
  entriesInput,
  draftEntries,
  activeThreadKey,
  syncing,
  detailLoading,
  decisionFirst = false,
  ...timelineProps
}: Omit<ComponentProps<typeof MessagesTimeline>, "timelineEntries"> & {
  /** Null until the thread's detail may load; see resolveThreadDetailRef. */
  threadDetailRef: ScopedThreadRef | null;
  entriesInput: Omit<TimelineEntriesInput, "visibleTurnItems">;
  /** A local draft's optimistic rows; null for a server thread. */
  draftEntries: ReadonlyArray<TimelineEntry> | null;
  activeThreadKey: string | null;
  syncing: boolean;
  detailLoading: boolean;
  decisionFirst?: boolean | undefined;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const visibleTurnItems = useThreadVisibleTurnItems(threadDetailRef);
  const serverEntries = useIncrementalTimelineEntries(activeThreadKey, {
    ...entriesInput,
    visibleTurnItems,
  });
  const entries = draftEntries ?? serverEntries;
  const displayedEntries = resolveThreadSwitchTimeline({
    loading: entries.length === 0 && syncing,
    activeThreadKey,
    nextEntries: entries,
    rememberedForActive: peekRememberedThreadTimeline<typeof entries>(activeThreadKey),
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- stores the committed ready timeline in the module-level cache used during thread switches
  useLayoutEffect(() => {
    if (detailLoading || entries.length === 0 || timelineHasEphemeralPreviewUrls(entries)) {
      return;
    }
    rememberReadyThreadTimeline({ threadKey: activeThreadKey, entries });
  }, [activeThreadKey, detailLoading, entries]);
  const focusedEntries =
    decisionFirst && !historyOpen ? decisionTimeline(displayedEntries) : displayedEntries;
  const context = displayedEntries.findLast(
    (entry) => entry.kind === "message" && entry.message.role === "user",
  );
  return (
    <>
      {decisionFirst ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            {historyOpen ? "Latest answer only" : "Show context and history"}
          </Button>
          {!historyOpen && context?.kind === "message" ? (
            <details className="min-w-0 max-w-xl text-xs text-muted-foreground">
              <summary className="cursor-pointer">Your request</summary>
              <p className="max-h-40 overflow-auto whitespace-pre-wrap py-2 wrap-anywhere">
                {context.message.text}
              </p>
            </details>
          ) : null}
        </div>
      ) : null}
      <MessagesTimeline
        {...timelineProps}
        historyControls={decisionFirst && !historyOpen ? undefined : timelineProps.historyControls}
        timelineEntries={focusedEntries}
      />
    </>
  );
}
