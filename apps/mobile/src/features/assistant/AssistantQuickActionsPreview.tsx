import { useNavigation } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { Modal, Platform, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { resolveAssistantFastAction, type AssistantDestination } from "./fastActions";

/**
 * Opt-in downstream Android experiment. This is a quick-action preview, NOT a
 * conversational or listening assistant. It deliberately cannot send, approve,
 * stop, or read threads. Complex intents only display an honest not-ready state.
 */
export function AssistantQuickActionsPreview() {
  const navigation = useNavigation();
  const workspace = useWorkspaceTabs();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

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
      setVisible(false);
    },
    [navigation, workspace],
  );

  const submit = useCallback(() => {
    const result = resolveAssistantFastAction(input);
    if (result.kind !== "action") {
      setNotice("This request needs the conversational assistant, which is not connected yet.");
      return;
    }
    if (result.action.kind === "navigate") {
      navigate(result.action.destination);
      setInput("");
      return;
    }
    if (result.action.kind === "find-thread") {
      setNotice("Thread selection is not connected yet. Open it from Chats for now.");
      return;
    }
    setNotice("A cross-thread status summary needs the read-only V2 adapter. Not connected yet.");
  }, [input, navigate]);

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
        <View className="flex-1 justify-center px-5">
          <Pressable
            accessibilityLabel="Close quick actions"
            accessibilityRole="button"
            className="absolute inset-0 bg-black/60"
            onPress={() => setVisible(false)}
          />
          <View className="gap-3 rounded-[24px] border border-border bg-card p-5">
            <Text className="text-lg font-t3-bold text-foreground">Assistant quick actions</Text>
            <Text className="text-sm text-foreground-muted">
              Text-only prototype. Try “show PRs”, “open environments”, or “usage limits”.
            </Text>
            <TextInput
              accessibilityLabel="Assistant quick-action command"
              autoCapitalize="sentences"
              className="min-h-[48px] rounded-xl border border-input-border bg-input px-4 text-foreground"
              placeholder="Where should we go?"
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
            <View className="flex-row justify-end gap-2">
              <Pressable
                accessibilityRole="button"
                className="rounded-xl px-4 py-3"
                onPress={() => setVisible(false)}
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
      </Modal>
    </>
  );
}
