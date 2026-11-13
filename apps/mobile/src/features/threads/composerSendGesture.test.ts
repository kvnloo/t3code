import { describe, expect, it } from "vite-plus/test";
import { armComposerSendGesture, moveComposerSendGesture, releaseComposerSendGesture, type ComposerSendGesture } from "./composerSendGesture";

const pressed = { phase: "pressed", x: 10, y: 10, scope: "environment/thread/draft", alternate: "steer" } as const;

describe("composer send gesture", () => {
  it("only dispatches an armed alternate once and never on a short tap", () => {
    expect(releaseComposerSendGesture(pressed, pressed.scope, "steer", false).action).toBeNull();
    const released = releaseComposerSendGesture(armComposerSendGesture(pressed), pressed.scope, "steer", false);
    expect(released.action).toBe("steer");
    expect(released.gesture.phase).toBe("consumed");
    expect(releaseComposerSendGesture(released.gesture, pressed.scope, "steer", false).action).toBeNull();
  });

  it("cancels permanently when the finger slides away", () => {
    const armed = armComposerSendGesture(pressed);
    expect(moveComposerSendGesture(armed, 15, 15).phase).toBe("armed");
    const cancelled = moveComposerSendGesture(armed, 50, 10);
    expect(moveComposerSendGesture(cancelled, 10, 10).phase).toBe("cancelled");
    expect(releaseComposerSendGesture(cancelled, pressed.scope, "steer", false).action).toBeNull();
  });

  it("does not send to a different scope or after capability/disabled changes", () => {
    const armed = armComposerSendGesture(pressed);
    expect(releaseComposerSendGesture(armed, "another-thread", "steer", false).action).toBeNull();
    expect(releaseComposerSendGesture(armed, pressed.scope, null, false).action).toBeNull();
    expect(releaseComposerSendGesture(armed, pressed.scope, "steer", true).action).toBeNull();
    const unsupported: ComposerSendGesture = { ...pressed, alternate: null };
    expect(armComposerSendGesture(unsupported).phase).toBe("pressed");
  });
});
