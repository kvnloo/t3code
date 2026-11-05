import { EnvironmentId, type ThreadTagStyle } from "@t3tools/contracts";
import { threadMenuTags } from "@t3tools/client-runtime/state/thread-tag-badges";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

type ButtonProps = {
  children?: ReactNode;
  label?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  onPress: () => void;
};
type Write = {
  environmentId: EnvironmentId;
  input: { patch: { threadTagStyles: ReadonlyArray<ThreadTagStyle> } };
};

const mocks = vi.hoisted(() => ({
  styles: [] as ReadonlyArray<ThreadTagStyle>,
  writable: true,
  dispatchAllowed: true,
  managed: false,
  update: vi.fn<(write: Write) => Promise<AtomCommandResult<void, string>>>(),
  openSettings: vi.fn(),
}));

vi.mock("react-native", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    View: Container,
    ScrollView: Container,
    KeyboardAvoidingView: Container,
    Modal: Container,
    Platform: { OS: "android" },
    Pressable: ({ children, disabled, onPress, accessibilityLabel }: ButtonProps) => (
      <button disabled={disabled} onClick={onPress} aria-label={accessibilityLabel}>
        {children}
      </button>
    ),
    TextInput: (props: {
      accessibilityLabel: string;
      value: string;
      editable?: boolean;
      onChangeText: (value: string) => void;
    }) => (
      <input
        aria-label={props.accessibilityLabel}
        value={props.value}
        disabled={props.editable === false}
        onInput={(event) => props.onChangeText(event.currentTarget.value)}
      />
    ),
  };
});
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../components/ui/Button", () => ({
  Button: ({ label, disabled, onPress, accessibilityLabel }: ButtonProps) => (
    <button disabled={disabled} onClick={onPress} aria-label={accessibilityLabel}>
      {label}
    </button>
  ),
}));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({}) }));
vi.mock("../settings/settings-navigation", () => ({ openSettings: mocks.openSettings }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => mocks.styles }));
vi.mock("../../state/server", () => ({
  serverEnvironment: { threadTagStylesAtom: () => ({}), updateSettings: {} },
}));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => mocks.writable,
  readEnvironmentScope: () => mocks.dispatchAllowed,
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({
    environments: [
      {
        environmentId: "env-tags",
        serverConfig: {
          managedPolicy: { lockedSettings: mocks.managed ? ["threadTagStyles"] : [] },
        },
      },
    ],
  }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.update }));

import { ThreadTagsEditor } from "./ThreadTagsEditor";

const environmentId = EnvironmentId.makeUnsafe("env-tags");
const original: ThreadTagStyle = {
  tag: "Focus",
  displayName: "Focus time",
  color: "red",
  icon: "flame",
};

function setup(options: { writable?: boolean; managed?: boolean } = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.styles = [original, { tag: "private", color: "gray" }];
  mocks.writable = options.writable ?? true;
  mocks.dispatchAllowed = true;
  mocks.managed = options.managed ?? false;
  mocks.update.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  mocks.openSettings.mockReset();
  const container = document.createElement("div");
  const root = createRoot(container);
  const onToggle = vi.fn();
  const onBeforeManage = vi.fn();
  const render = () =>
    act(() =>
      root.render(
        <ThreadTagsEditor
          environmentId={environmentId}
          tags={threadMenuTags(["Focus"], mocks.styles)}
          onToggle={onToggle}
          onBeforeManage={onBeforeManage}
        />,
      ),
    );
  render();
  const button = (label: string) => {
    const found = [...container.querySelectorAll("button")].find(
      (entry) => (entry.getAttribute("aria-label") ?? entry.textContent) === label,
    );
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  };
  return {
    container,
    render,
    button,
    onToggle,
    onBeforeManage,
    click: async (label: string) => {
      await act(async () => button(label).click());
    },
    rename: (name: string) => {
      const input = container.querySelector<HTMLInputElement>(
        'input[aria-label="Tag display name"]',
      );
      if (!input) throw new Error("Missing display name input");
      act(() => {
        input.value = name;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
    [Symbol.dispose]: () => act(() => root.unmount()),
  };
}

describe("ThreadTagsEditor", () => {
  it("keeps assignment identity through pencil editing, save, reload and toggle", async () => {
    using screen = setup();
    await screen.click("Edit Focus time appearance");
    expect(screen.onToggle).not.toHaveBeenCalled();
    screen.rename("Deep work");
    await screen.click("blue color");
    await screen.click("star icon");
    await screen.click("Save");
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: {
        patch: {
          threadTagStyles: [
            { tag: "Focus", displayName: "Deep work", color: "blue", icon: "star" },
            mocks.styles[1],
          ],
        },
      },
    });
    const saved = mocks.update.mock.calls[0]?.[0].input.patch.threadTagStyles;
    expect(saved).toBeDefined();
    mocks.styles = saved ?? [];
    screen.render();
    await screen.click("Remove Deep work");
    expect(screen.onToggle).toHaveBeenCalledExactlyOnceWith("Focus");
    expect(screen.container.querySelector('input[aria-label="Tag display name"]')).toBeNull();
  });

  it("cancels without saving or applying a tag and blocks invalid names", async () => {
    using screen = setup();
    await screen.click("Edit Focus time appearance");
    screen.rename("private");
    expect(screen.button("Save").disabled).toBe(true);
    screen.rename("Draft only");
    await screen.click("Cancel");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.onToggle).not.toHaveBeenCalled();
    await screen.click("Edit Focus time appearance");
    expect(
      screen.container.querySelector<HTMLInputElement>('input[aria-label="Tag display name"]')
        ?.value,
    ).toBe("Focus time");
  });

  it("retains a failed draft, prevents overlapping writes and allows retry", async () => {
    using screen = setup();
    const pending = Promise.withResolvers<AtomCommandResult<void, string>>();
    mocks.update.mockReturnValueOnce(pending.promise);
    await screen.click("Edit Focus time appearance");
    screen.rename("Retry this");
    await screen.click("Save");
    expect(screen.button("Save").disabled).toBe(true);
    expect(screen.button("Cancel").disabled).toBe(true);
    await screen.click("Save");
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(AsyncResult.failure(Cause.fail("offline"))));
    expect(screen.container.textContent).toContain("Could not save tags");
    expect(
      screen.container.querySelector<HTMLInputElement>('input[aria-label="Tag display name"]')
        ?.value,
    ).toBe("Retry this");
    await screen.click("Save");
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(screen.container.querySelector('input[aria-label="Tag display name"]')).toBeNull();
  });

  it.each([{ writable: false }, { managed: true }])(
    "blocks appearance edits for %j",
    async (options) => {
      using screen = setup(options);
      expect(screen.button("Edit Focus time appearance").disabled).toBe(true);
      expect(screen.button("Add tag").disabled).toBe(true);
      await screen.click("Edit Focus time appearance");
      expect(screen.container.querySelector('input[aria-label="Tag display name"]')).toBeNull();
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it("checks the destination permission again at save time", async () => {
    using screen = setup();
    await screen.click("Edit Focus time appearance");
    screen.rename("Cannot write");
    mocks.dispatchAllowed = false;
    await screen.click("Save");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(
      screen.container.querySelector<HTMLInputElement>('input[aria-label="Tag display name"]')
        ?.value,
    ).toBe("Cannot write");
  });

  it("opens Settings for the selected environment and stable tag key", async () => {
    using screen = setup();
    await screen.click("Edit Focus time appearance");
    screen.rename("Unsaved label");
    await screen.click("Manage this tag in Settings");
    expect(screen.onBeforeManage).toHaveBeenCalledOnce();
    expect(mocks.openSettings).toHaveBeenCalledExactlyOnceWith({}, "SettingsThreadTags", {
      environmentId,
      tag: "Focus",
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.onToggle).not.toHaveBeenCalled();
  });
});
