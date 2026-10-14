import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import { Atom } from "effect/reactivity";
import { useCallback, useMemo, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { environmentCatalog } from "../../connection/catalog";
import { useNavigationThreadShells } from "../../state/entities";
import { environmentShell } from "../../state/shell";
import { useRemoteConnectionStatus } from "../../state/use-remote-environment-registry";
import { useAndroidWorkspaceSelection } from "../workspace/useAndroidWorkspaceSelection";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import {
  buildAssistantAttentionSnapshot,
  type AssistantAttentionKind,
  type AssistantAttentionItem,
} from "./attentionSnapshot";
import {
  findUniqueVisibleAssistantThread,
  resolveAssistantFastAction,
  type AssistantDestination,
} from "./fastActions";

/**
 * This atom intentionally observes only shell readiness, not each transcript.
 * It is mounted only while the opt-in assistant sheet is open.
 */
const liveShellsAtom = Atom.make((get) => {
  const readiness = new Map<string, boolean>();
  for (const environmentId of get(environmentCatalog.catalogValueAtom).entries.keys()) {
    readiness.set(
      String(environmentId),
      get(environmentShell.stateValueAtom(environmentId)).status === "live",
    );
  }
  return readiness;
}).pipe(Atom.withLabel("mobile:assistant:live-shell-readiness"));

type AttentionFilter = "all" | "needs-me" | "working";

const LABELS: Readonly<Record<AssistantAttentionKind, string>> = {
  approval: "Approval needed",
  question: "Answer needed",
  plan: "Plan review",
  failed: "Failed",
  working: "Working",
};

function isNeedsMe(kind: AssistantAttentionKind): boolean {
  return kind === "approval" || kind === "question" || kind === "plan" || kind === "failed";
}

/** Opt-in downstream text experiment, not a voice or autonomous executor. */
export function AssistantQuickActionsPreview() {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);

  if (Platform.OS !== "android") return null;

  return (
    <>
      <View
        pointerEvents="box-none"
        className="absolute right-4"
        style={{ top: Math.max(insets.top, 12) + 58 }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open experimental assistant quick actions"
          className="rounded-full border border-border bg-card px-3 py-2 active:opacity-80"
          onPress={() => setVisible(true)}
        >
          <Text className="text-xs font-t3-bold text-foreground">Quick actions</Text>
        </Pressable>
      </View>
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        {visible ? <AssistantQuickActionsContent onClose={() => setVisible(false)} /> : null}
      </Modal>
    </>
  );
}

/**
 * Keep all shell subscriptions inside this conditional child. The hidden
 * assistant must not scan the whole workspace on every streaming update.
 */
function AssistantQuickActionsContent(props: { readonly onClose: () => void }) {
  const navigation = useNavigation();
  const workspace = useWorkspaceTabs();
  const selectAndroidWorkspace = useAndroidWorkspaceSelection();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<AttentionFilter>("all");
  const threads = useNavigationThreadShells();
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const shellLive = useAtomValue(liveShellsAtom);

  const attention = useMemo(
    () =>
      buildAssistantAttentionSnapshot(
        connectedEnvironments.map((environment) => ({
          environmentId: String(environment.environmentId),
          label: environment.environmentLabel,
          enabled: environment.isEnabled,
          connected: environment.connectionState === "connected",
          shellLive: shellLive.get(String(environment.environmentId)) === true,
        })),
        threads.map((thread) => ({
          environmentId: String(thread.environmentId),
          threadId: String(thread.id),
          title: thread.title,
          updatedAt: thread.updatedAt,
          needsApproval: thread.hasPendingApprovals,
          needsAnswer: thread.hasPendingUserInput,
          needsPlanReview:
            thread.interactionMode === "plan" && thread.hasActionableProposedPlan,
          failed: thread.latestRun?.status === "failed" || thread.runtime?.status === "failed",
          working: isThreadWorking(thread),
        })),
      ),
    [connectedEnvironments, shellLive, threads],
  );

  const liveIds = useMemo(
    () =>
      new Set(
        connectedEnvironments
          .filter(
            (environment) =>
              environment.isEnabled &&
              environment.connectionState === "connected" &&
              shellLive.get(String(environment.environmentId)) === true,
          )
          .map((environment) => String(environment.environmentId)),
      ),
    [connectedEnvironments, shellLive],
  );

  const openThread = useCallback(
    (environmentId: string, threadId: string) => {
      // Re-check the current projection on tap, rather than trusting an old
      // utterance target or another environment's cached shell.
      const current = threads.find(
        (thread) =>
          String(thread.environmentId) === environmentId && String(thread.id) === threadId,
      );
      if (current === undefined || !liveIds.has(environmentId)) {
        setNotice("That thread is no longer live here. Open Chats to reconnect.");
        return;
      }
      props.onClose();
      selectAndroidWorkspace({
        name: "Thread",
        params: { environmentId, threadId },
      });
    },
    [liveIds, props.onClose, selectAndroidWorkspace, threads],
  );

  const navigate = useCallback(
    (destination: AssistantDestination) => {
      if (destination === "chats" || destination === "pulls") {
        workspace?.dispatch({
          type: "select",
          tab: destination === "chats" ? "threads" : "pullRequests",
        });
        navigation.navigate("Home");
      } else {
        navigation.navigate("SettingsSheet", {
          screen: "SettingsContent",
          params: {
            screen: destination === "usage" ? "SettingsUsage" : "SettingsEnvironments",
          },
        });
      }
      setNotice(null);
      props.onClose();
    },
    [navigation, props.onClose, workspace],
  );

  const submit = useCallback(() => {
    const result = resolveAssistantFastAction(input);
    if (result.kind !== "action") {
      setNotice("Conversation mode is not connected yet. Only read-only quick actions work.");
      return;
    }
    if (result.action.kind === "navigate") {
      navigate(result.action.destination);
      return;
    }
    if (result.action.kind === "inspect") {
      setFilter(result.action.queue === "working" ? "working" : "needs-me");
      setNotice(null);
      setInput("");
      return;
    }
    const candidates = threads
      .filter((thread) => liveIds.has(String(thread.environmentId)))
      .map((thread) => ({
        environmentId: String(thread.environmentId),
        threadId: String(thread.id),
        title: thread.title,
      }));
    const match = findUniqueVisibleAssistantThread(result.action.title, candidates);
    if (match !== null) {
      openThread(match.environmentId, match.threadId);
      return;
    }
    setNotice(
      "No unique live thread has that title. Select a thread from Chats to disambiguate.",
    );
  }, [input, liveIds, navigate, openThread, threads]);

  const visibleItems = attention.items.filter((item) =>
    filter === "all" ? true : filter === "working" ? item.kind === "working" : isNeedsMe(item.kind),
  );
  const shownItems = visibleItems.slice(0, 24);
  const needsMeCount =
    attention.counts.approval +
    attention.counts.question +
    attention.counts.plan +
    attention.counts.failed;

  return (
    <View className="flex-1 justify-center px-4" style={{ paddingBottom: insets.bottom }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close assistant quick actions"
        className="absolute inset-0 bg-black/60"
        onPress={props.onClose}
      />
      <View
        className="gap-3 rounded-[24px] border border-border bg-card p-4"
        style={{ maxHeight: Math.min(height - insets.top - insets.bottom - 28, 700) }}
      >
        <Text className="text-lg font-t3-bold text-foreground">Assistant preview</Text>
        <Text className="text-xs text-foreground-muted">
          Read-only attention across connected T3 environments. Voice and write actions are off.
        </Text>
        <TextInput
          accessibilityLabel="Assistant quick-action command"
          autoCapitalize="sentences"
          className="min-h-[48px] rounded-xl border border-input-border bg-input px-4 text-foreground"
          placeholder="Show approvals, working agents, PRs..."
          placeholderTextColor="#999999"
          returnKeyType="go"
          value={input}
          onChangeText={setInput}
          onSubmitEditing={submit}
        />
        {notice !== null ? (
          <Text accessibilityRole="alert" className="text-sm text-foreground-muted">
            {notice}
          </Text>
        ) : null}
        <View className="flex-row gap-2">
          {([
            ["all", "All", attention.items.length],
            ["needs-me", "Needs me", needsMeCount],
            ["working", "Working", attention.counts.working],
          ] as const).map(([nextFilter, label, count]) => (
            <Pressable
              key={nextFilter}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === nextFilter }}
              className={
                filter === nextFilter
                  ? "rounded-full bg-primary px-3 py-2"
                  : "rounded-full bg-subtle px-3 py-2"
              }
              onPress={() => setFilter(nextFilter)}
            >
              <Text
                className={
                  filter === nextFilter
                    ? "text-xs font-t3-bold text-primary-foreground"
                    : "text-xs font-t3-medium text-foreground"
                }
              >
                {label} {count}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text className="text-xs text-foreground-muted">
          Live environments: {attention.liveEnvironmentCount} / {connectedEnvironments.length}
        </Text>
        {attention.unavailableEnvironments.length > 0 ? (
          <Text className="text-xs text-foreground-muted">
            Excluded (offline, off or still syncing): {attention.unavailableEnvironments.join(", ")}
          </Text>
        ) : null}
        <ScrollView className="min-h-0" keyboardShouldPersistTaps="handled">
          {shownItems.length === 0 ? (
            <Text className="py-4 text-sm text-foreground-muted">
              No current {filter === "working" ? "working threads" : "attention items"} from live environments.
            </Text>
          ) : (
            shownItems.map((item: AssistantAttentionItem) => (
              <Pressable
                key={JSON.stringify([item.environmentId, item.threadId])}
                accessibilityRole="button"
                accessibilityLabel={LABELS[item.kind] + ": " + item.title + " on " + item.environmentLabel}
                className="border-b border-border px-2 py-3 active:opacity-70"
                onPress={() => openThread(item.environmentId, item.threadId)}
              >
                <Text numberOfLines={2} className="text-sm font-t3-medium text-foreground">
                  {item.title || "Untitled thread"}
                </Text>
                <Text className="text-xs text-foreground-muted">
                  {LABELS[item.kind]} · {item.environmentLabel}
                </Text>
              </Pressable>
            ))
          )}
          {visibleItems.length > shownItems.length ? (
            <Text className="py-2 text-xs text-foreground-muted">
              Showing {shownItems.length} of {visibleItems.length} items. Open Chats for the rest.
            </Text>
          ) : null}
        </ScrollView>
        <View className="flex-row justify-end gap-2">
          <Pressable
            accessibilityRole="button"
            className="rounded-xl px-4 py-3"
            onPress={props.onClose}
          >
            <Text className="font-t3-medium text-foreground">Close</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            className="rounded-xl bg-primary px-4 py-3 disabled:opacity-40"
            disabled={!input.trim()}
            onPress={submit}
          >
            <Text className="font-t3-bold text-primary-foreground">Go</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
