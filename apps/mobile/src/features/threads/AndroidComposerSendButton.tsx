import { useRef, useState } from "react";
import { View } from "react-native";
import * as Haptics from "expo-haptics";
import type { ActiveTurnComposerAction } from "@t3tools/client-runtime/state/composer-dispatch";
import { ComposerActionButton } from "../../components/ComposerToolbar";
import { AppText as Text } from "../../components/ui/AppText";
import { armComposerSendGesture, moveComposerSendGesture, releaseComposerSendGesture, type ComposerSendGesture } from "./composerSendGesture";
import type { ComposerSendPresentation } from "./composerSendPresentation";

export function AndroidComposerSendButton(props: {
  readonly scope: string;
  readonly size?: "regular" | "large";
  readonly accessibilityLabel: string;
  readonly presentation: ComposerSendPresentation;
  readonly disabled: boolean;
  readonly onSend: (followUp?: ActiveTurnComposerAction) => void;
}) {
  const gesture = useRef<ComposerSendGesture>({ phase: "idle" });
  const [armed, setArmed] = useState(false);
  const alternate = props.presentation.alternate;
  const cancel = () => {
    gesture.current = { phase: "cancelled" };
    setArmed(false);
  };
  const alternateLabel = alternate === "steer" ? "steer" : alternate === "restart" ? "restart" : "queue";
  return (
    <View>
      {armed ? (
        <View pointerEvents="none" className="absolute bottom-full right-0 rounded-lg bg-card px-3 py-2" style={{ minWidth: 160 }}>
          <Text accessibilityLiveRegion="polite" className="text-xs text-foreground">Release to {alternateLabel}</Text>
        </View>
      ) : null}
      <ComposerActionButton
        size={props.size}
        accessibilityLabel={armed ? `Release to ${alternateLabel}` : props.accessibilityLabel}
        accessibilityHint={alternate ? `Tap to ${props.presentation.label.toLowerCase()}. Hold and release to ${alternateLabel}; slide away to cancel.` : undefined}
        accessibilityActions={alternate ? [{ name: "alternate", label: `${alternateLabel} now` }] : undefined}
        onAccessibilityAction={(event) => {
          if (!props.disabled && alternate && event.nativeEvent.actionName === "alternate") {
            cancel();
            props.onSend(alternate);
          }
        }}
        icon={armed && alternate === "steer" ? "arrow.turn.left.up" : props.presentation.icon}
        variant="primary"
        disabled={props.disabled}
        onPressIn={(event) => {
          gesture.current = {
            phase: "pressed", x: event.nativeEvent.pageX, y: event.nativeEvent.pageY,
            scope: props.scope, alternate,
          };
          setArmed(false);
        }}
        onLongPress={() => {
          if (props.disabled) return;
          gesture.current = armComposerSendGesture(gesture.current);
          if (gesture.current.phase === "armed") {
            setArmed(true);
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
          }
        }}
        onTouchMove={(event) => {
          gesture.current = moveComposerSendGesture(gesture.current, event.nativeEvent.pageX, event.nativeEvent.pageY);
          if (gesture.current.phase === "cancelled") setArmed(false);
        }}
        onTouchCancel={cancel}
        onTouchEnd={() => {
          const result = releaseComposerSendGesture(gesture.current, props.scope, alternate, props.disabled);
          gesture.current = result.gesture;
          setArmed(false);
          if (result.action !== null) props.onSend(result.action);
        }}
        onPress={() => {
          if (props.disabled || gesture.current.phase === "consumed" || gesture.current.phase === "cancelled" || gesture.current.phase === "armed") return;
          gesture.current = { phase: "consumed" };
          props.onSend();
        }}
      />
    </View>
  );
}
