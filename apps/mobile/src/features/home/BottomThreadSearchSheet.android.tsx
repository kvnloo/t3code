import { useAtomValue } from "@effect/atom-react";
import { pickableProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import {
  threadSearchMatchKey,
} from "@t3tools/client-runtime/state/thread-search";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useRef, useState } from "react";
import { FlatList, Keyboard, Pressable, View, type TextInputInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { SearchField } from "../../components/ui/SearchField";
import { Sheet } from "../../components/ui/Sheet";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { useProjects } from "../../state/entities";
import { useThreadSearch } from "../../state/queries";
import { environmentThreadShells } from "../../state/threads";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { useWorkspaceState } from "../../state/workspace";
import { requestThreadMessageJump } from "../threads/threadMessageJump";
import { buildThreadListV2Items } from "../threads/threadListV2";
import { useThreadListSearchMatches } from "../threads/useThreadListSearchMatches";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { useHomeListOptions } from "./home-list-options";
import { buildHomeProjectScopes, findHomeProjectScope } from "./homeThreadList";
import { resolveScratchProjectScopeKey } from "@t3tools/client-runtime/state/project-grouping";

export function BottomThreadSearchSheet(props: {
  readonly query: string;
  readonly onChangeQuery: (query: string) => void;
  readonly onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInputInstance>(null);
  const [now] = useState(() => new Date().toISOString());
  const threads = useAtomValue(environmentThreadShells.navigationThreadShellsAtom);
  const projects = useProjects();
  const { environments } = useWorkspaceState();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const selectDetail = useSelectWorkspaceDetail();
  const availableEnvironmentIds = new Set(
    Object.values(savedConnectionsById).map((connection) => connection.environmentId),
  );
  const { options } = useHomeListOptions(availableEnvironmentIds);
  const projectKey = resolveScratchProjectScopeKey(options.selectedProjectKey, projects, {
    sidebarProjectGroupingMode: options.projectGroupingMode,
    sidebarProjectGroupingOverrides: {},
  });
  const projectScope = findHomeProjectScope(
    pickableProjectGroups(
      buildHomeProjectScopes({
        projects,
        environmentId: options.selectedEnvironmentId,
        projectGroupingMode: options.projectGroupingMode,
      }),
    ),
    projectKey,
  );
  const searchEnvironmentIds =
    options.selectedEnvironmentId === null
      ? environments
          .filter((environment) => environment.connectionState === "connected")
          .map((environment) => environment.environmentId)
      : environments.some(
            (environment) =>
              environment.environmentId === options.selectedEnvironmentId &&
              environment.connectionState === "connected",
          )
        ? [options.selectedEnvironmentId]
        : [];
  const search = useThreadSearch(
    searchEnvironmentIds,
    props.query,
    projectScope === null
      ? {}
      : { projectIds: projectScope.projectRefs.map((ref) => ref.projectId) },
  );
  const matches = useThreadListSearchMatches(threads, search);
  const layout = buildThreadListV2Items({
    threads,
    environmentId: options.selectedEnvironmentId,
    projectRefs: projectScope?.projectRefs ?? null,
    searchQuery: props.query,
    matchedThreadKeys: new Set(matches.keys()),
    now,
  });
  const results = props.query.trim().length > 0 ? layout.items : [];

  const openThread = (thread: EnvironmentThreadShell) => {
    const key = threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id });
    const messageId = layout.contentOnlyThreadKeys.has(key) ? matches.get(key)?.messageId : undefined;
    if (messageId) {
      requestThreadMessageJump(scopedThreadKey(thread.environmentId, thread.id), messageId);
    }
    Keyboard.dismiss();
    props.onClose();
    selectDetail({
      name: "Thread",
      params: { environmentId: String(thread.environmentId), threadId: String(thread.id) },
    });
  };

  return (
    <Sheet title="Search threads" onClose={props.onClose}>
      <View className="flex-1 bg-screen">
        <FlatList
          data={results}
          keyExtractor={(item) => scopedThreadKey(item.thread.environmentId, item.thread.id)}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.thread.title || "Untitled thread"}
              onPress={() => openThread(item.thread)}
              className="border-b border-border px-5 py-4 active:bg-subtle"
            >
              <Text className="font-t3-medium text-foreground" numberOfLines={2}>
                {item.thread.title || "Untitled thread"}
              </Text>
              {item.thread.branch ? (
                <Text className="mt-1 text-xs text-foreground-muted" numberOfLines={1}>
                  {item.thread.branch}
                </Text>
              ) : null}
            </Pressable>
          )}
          ListEmptyComponent={
            props.query.trim().length === 0 ? (
              <EmptyState
                title="Search threads"
                detail="Type to find threads and matching messages."
                variant="plain"
              />
            ) : search.isPending ? (
              <EmptyState title="Searching messages" detail="Checking environments." variant="plain" />
            ) : (
              <EmptyState
                title="No results"
                detail={`No threads matching "${props.query}".`}
                variant="plain"
              />
            )
          }
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
        <View
          className="flex-row border-t border-border bg-header px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          <SearchField
            inputRef={inputRef}
            accessibilityLabel="Search threads"
            clearAccessibilityLabel="Clear search"
            placeholder="Search threads and messages"
            value={props.query}
            onChangeText={props.onChangeQuery}
          />
        </View>
      </View>
    </Sheet>
  );
}
