import { useAtomValue } from "@effect/atom-react";
import { LegendList } from "@legendapp/list/react-native";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  needsYouAwaitsDecision,
  needsYouKey,
  needsYouQueue,
} from "@t3tools/client-runtime/state/needs-you";
import { canSnooze } from "@t3tools/client-runtime/state/thread-settled";
import { useMemo, useState } from "react";
import { Platform, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { useProjects } from "../../state/entities";
import { environmentThreadShells } from "../../state/threads";
import { useThreadListNow } from "../threads/use-thread-list-now";
import { useThreadListActions } from "../home/useThreadListActions";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";

const LATER_MS = 60 * 60 * 1000;

function laterUntil() {
  return new Date(Date.now() + LATER_MS).toISOString();
}

type QueueItem = ReturnType<typeof needsYouQueue>[number];

export function NeedsYouScreen() {
  const threads = useAtomValue(environmentThreadShells.navigationThreadShellsAtom);
  const now = useThreadListNow(threads);
  const projects = useProjects();
  const selectDetail = useSelectWorkspaceDetail();
  const { settleThread, snoozeThread } = useThreadListActions();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const queue = useMemo(() => needsYouQueue(threads, now), [threads, now]);
  const projectTitles = useMemo(
    () =>
      new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project.title])),
    [projects],
  );

  const act = async (thread: EnvironmentThreadShell, action: "settle" | "later") => {
    const key = needsYouKey(thread);
    setPendingKey(key);
    setFailedKey(null);
    const ok =
      action === "settle"
        ? await settleThread(thread)
        : await snoozeThread(thread, laterUntil());
    setPendingKey(null);
    if (!ok) setFailedKey(key);
  };

  if (queue.length === 0) {
    return (
      <View className="flex-1 justify-center bg-screen px-6">
        <EmptyState
          variant="plain"
          title="Nothing needs you"
          detail="Agents can keep working. Questions, approvals and results will appear here when they need your attention."
        />
      </View>
    );
  }

  return (
    <LegendList
      renderScrollComponent={Platform.OS === "ios" ? NativeScrollView : undefined}
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingBottom: 32 }}
      data={queue}
      estimatedItemSize={120}
      keyExtractor={(item: QueueItem) => item.key}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }: { item: QueueItem }) => (
        <NeedsYouRow
          item={item}
          projectTitle={
            projectTitles.get(`${item.thread.environmentId}:${item.thread.projectId}`) ?? "Project"
          }
          now={now}
          pending={pendingKey === item.key}
          failed={failedKey === item.key}
          onOpen={() =>
            selectDetail({
              name: "Thread",
              params: {
                environmentId: String(item.thread.environmentId),
                threadId: String(item.thread.id),
              },
            })
          }
          onLater={() => void act(item.thread, "later")}
          onSettle={() => void act(item.thread, "settle")}
        />
      )}
    />
  );
}

function NeedsYouRow(props: {
  readonly item: QueueItem;
  readonly projectTitle: string;
  readonly now: string;
  readonly pending: boolean;
  readonly failed: boolean;
  readonly onOpen: () => void;
  readonly onLater: () => void;
  readonly onSettle: () => void;
}) {
  const { thread, reason } = props.item;
  return (
    <View className="gap-2 border-b border-border px-4 py-3">
      <Pressable accessibilityRole="button" onPress={props.onOpen} className="gap-1">
        <Text className="text-xs text-foreground-muted" numberOfLines={1}>
          {props.projectTitle} · {reason}
          {thread.pinnedAt !== null ? " · Pinned" : ""}
        </Text>
        <Text className="text-base font-medium text-foreground" numberOfLines={2}>
          {thread.title}
        </Text>
      </Pressable>
      <View className="flex-row gap-2">
        <Button
          label="Later · 1h"
          tone="secondary"
          disabled={props.pending || !canSnooze(thread, { now: props.now })}
          onPress={props.onLater}
        />
        <Button
          label="Reviewed"
          tone="primary"
          disabled={props.pending || needsYouAwaitsDecision(thread)}
          onPress={props.onSettle}
        />
      </View>
      {props.failed ? (
        <Text className="text-xs text-danger">
          Could not update this thread. It remains in your inbox.
        </Text>
      ) : null}
    </View>
  );
}
