import type { ActiveTurnComposerAction } from "@t3tools/client-runtime/state/composer-dispatch";

export type ComposerSendGesture =
  | { readonly phase: "idle" | "cancelled" | "consumed" }
  | {
      readonly phase: "pressed" | "armed";
      readonly x: number;
      readonly y: number;
      readonly scope: string;
      readonly alternate: ActiveTurnComposerAction | null;
    };

export function moveComposerSendGesture(gesture: ComposerSendGesture, x: number, y: number): ComposerSendGesture {
  if (gesture.phase !== "pressed" && gesture.phase !== "armed") return gesture;
  return Math.hypot(x - gesture.x, y - gesture.y) > 24 ? { phase: "cancelled" } : gesture;
}

export function armComposerSendGesture(gesture: ComposerSendGesture): ComposerSendGesture {
  return gesture.phase === "pressed" && gesture.alternate !== null
    ? { ...gesture, phase: "armed" }
    : gesture;
}

export function releaseComposerSendGesture(
  gesture: ComposerSendGesture,
  scope: string,
  alternate: ActiveTurnComposerAction | null,
  disabled: boolean,
): { readonly gesture: ComposerSendGesture; readonly action: ActiveTurnComposerAction | null } {
  if (gesture.phase !== "armed") return { gesture, action: null };
  return {
    gesture: { phase: "consumed" },
    action: !disabled && gesture.scope === scope && gesture.alternate === alternate ? alternate : null,
  };
}
