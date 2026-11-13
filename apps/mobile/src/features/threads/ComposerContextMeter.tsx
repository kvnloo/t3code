import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useQuietThreadStructure } from "../../state/use-thread-detail";
import { contextWindowPresentation, deriveComposerContextWindow } from "./contextWindowPresentation";

export function ComposerContextMeter({ thread }: { readonly thread: EnvironmentThreadShell }) {
  const detail = useQuietThreadStructure(scopeThreadRef(thread.environmentId, thread.id));
  const usage = deriveComposerContextWindow(detail?.projection ?? null, thread.modelSelection);
  const presentation = contextWindowPresentation(usage);
  const [detailsOpen, setDetailsOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={presentation.accessibilityLabel}
        accessibilityHint="Shows context-window details"
        onPress={() => setDetailsOpen(true)}
        className="min-h-[44px] justify-center self-end px-2"
      >
        <Text className="text-xs text-foreground-muted">{presentation.label}</Text>
      </Pressable>
      <Modal
        visible={detailsOpen}
        transparent
        animationType="none"
        onRequestClose={() => setDetailsOpen(false)}
      >
        <View className="flex-1 justify-center bg-black/50 px-6">
          <View accessibilityViewIsModal className="gap-4 rounded-2xl bg-screen p-5">
            <Text accessibilityRole="header" className="text-lg text-foreground font-t3-bold">
              Context window
            </Text>
            <Text className="text-sm text-foreground">{presentation.details}</Text>
            <Button label="Close" onPress={() => setDetailsOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}
