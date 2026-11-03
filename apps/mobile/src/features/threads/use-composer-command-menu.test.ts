import { describe, expect, it, vi } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";

vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));

vi.mock("../../state/queries", () => ({
  useComposerPathSearch: () => ({ entries: [], isPending: false }),
  useComposerPullRequestSearch: () => ({ entries: [], isPending: false, error: null }),
}));
vi.mock("../../state/use-composer-drafts", () => ({
  getComposerDraftSnapshot: vi.fn(),
  setComposerDraftContext: vi.fn(),
  useComposerDraftSelection: vi.fn(),
}));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "context-id" }));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    providersValueAtom: vi.fn(),
    refreshProviders: Symbol("refreshProviders"),
  },
}));

import {
  buildComposerSlashCommandItems,
  resolveComposerCommandSelection,
  resolveComposerMenuSelection,
} from "./use-composer-command-menu";

describe("resolveComposerMenuSelection", () => {
  it("prefers the caret an insertion placed in the current draft text", () => {
    expect(
      resolveComposerMenuSelection({
        draftMessage: "hello @chip ",
        ownerKey: "draft-a",
        inserted: { start: 12, end: 12 },
        local: { ownerKey: "draft-a", start: 2, end: 2 },
      }),
    ).toEqual({ start: 12, end: 12 });
  });

  it("clamps the composer's own caret when the draft shrinks", () => {
    expect(
      resolveComposerMenuSelection({
        draftMessage: "hi",
        ownerKey: "draft-a",
        inserted: null,
        local: { ownerKey: "draft-a", start: 5, end: 9 },
      }),
    ).toEqual({ start: 2, end: 2 });
  });

  it("starts at the end of the draft after switching owners", () => {
    expect(
      resolveComposerMenuSelection({
        draftMessage: "other draft",
        ownerKey: "draft-b",
        inserted: null,
        local: { ownerKey: "draft-a", start: 1, end: 1 },
      }),
    ).toEqual({ start: 11, end: 11 });
  });
});

describe("mobile slash commands", () => {
  const antigravity = {
    driver: ProviderDriverKind.make("antigravity"),
    showInteractionModeToggle: false,
    slashCommands: [{ name: "plan", description: "Plan with Antigravity" }],
  };

  it.each([false, true])(
    "keeps native /plan with legacy mode enabled=%s",
    (allowInteractionMode) => {
      const items = buildComposerSlashCommandItems({
        query: "pl",
        atMessageStart: true,
        hasThread: true,
        allowInteractionMode,
        selectedProviderStatus: antigravity,
      });

      expect(items).toHaveLength(1);
      expect(items[0]?.type).toBe("provider-slash-command");
      const item = items[0];
      if (!item) throw new Error("Expected the native plan command");
      expect(
        resolveComposerCommandSelection({
          draftMessage: "/pl",
          trigger: { rangeStart: 0, rangeEnd: 3 },
          item,
          allowInteractionMode,
        }),
      ).toEqual({ text: "/plan ", cursor: 6, interactionMode: null });
    },
  );

  it("still applies the T3 plan command for supported providers", () => {
    const items = buildComposerSlashCommandItems({
      query: "plan",
      atMessageStart: true,
      hasThread: true,
      allowInteractionMode: true,
      selectedProviderStatus: {
        driver: ProviderDriverKind.make("codex"),
        slashCommands: [],
      },
    });
    const item = items[0];
    if (!item) throw new Error("Expected the T3 plan command");
    expect(
      resolveComposerCommandSelection({
        draftMessage: "/plan",
        trigger: { rangeStart: 0, rangeEnd: 5 },
        item,
        allowInteractionMode: true,
      }),
    ).toEqual({ text: "", cursor: 0, interactionMode: "plan" });

    expect(
      resolveComposerCommandSelection({
        draftMessage: "/plan",
        trigger: { rangeStart: 0, rangeEnd: 5 },
        item,
        allowInteractionMode: false,
      }),
    ).toEqual({ text: "/plan ", cursor: 6, interactionMode: null });
  });
});

describe("mobile /handoff", () => {
  const codex = (slashCommands: ReadonlyArray<{ name: string; description?: string }>) => ({
    driver: ProviderDriverKind.make("codex"),
    slashCommands,
  });

  it("offers /handoff at the message start of a thread and inserts it for a focus", () => {
    const items = buildComposerSlashCommandItems({
      query: "hand",
      atMessageStart: true,
      hasThread: true,
      handoffDisabledReason: null,
      allowInteractionMode: true,
      selectedProviderStatus: codex([]),
    });
    expect(items.map((item) => [item.id, item.label, item.description])).toEqual([
      ["cmd:handoff", "/handoff", "Continue in a new thread that keeps this conversation"],
    ]);
    const [item] = items;
    if (!item) throw new Error("Expected /handoff");
    expect(
      resolveComposerCommandSelection({
        draftMessage: "/hand",
        trigger: { rangeStart: 0, rangeEnd: 5 },
        item,
        allowInteractionMode: true,
      }),
    ).toEqual({ text: "/handoff ", cursor: 9, interactionMode: null });
  });

  it("shows why /handoff cannot run yet", () => {
    const [item] = buildComposerSlashCommandItems({
      query: "handoff",
      atMessageStart: true,
      hasThread: true,
      handoffDisabledReason: "Hand off after the first reply finishes.",
      allowInteractionMode: true,
      selectedProviderStatus: codex([]),
    });
    expect(item?.description).toBe("Hand off after the first reply finishes.");
  });

  it("hides /handoff in drafts, mid-message, and where it is not offered", () => {
    const base = {
      query: "handoff",
      allowInteractionMode: true,
      selectedProviderStatus: codex([]),
    };
    expect(
      buildComposerSlashCommandItems({
        ...base,
        atMessageStart: true,
        hasThread: false,
        handoffDisabledReason: null,
      }),
    ).toEqual([]);
    expect(
      buildComposerSlashCommandItems({
        ...base,
        atMessageStart: false,
        hasThread: true,
        handoffDisabledReason: null,
      }),
    ).toEqual([]);
    expect(
      buildComposerSlashCommandItems({ ...base, atMessageStart: true, hasThread: true }),
    ).toEqual([]);
  });

  it("lists T3's /handoff first and keeps the provider's /handoff reachable", () => {
    const items = buildComposerSlashCommandItems({
      query: "handoff",
      atMessageStart: true,
      hasThread: true,
      handoffDisabledReason: null,
      allowInteractionMode: true,
      selectedProviderStatus: codex([{ name: "handoff", description: "Write a handoff note" }]),
    });
    expect(items.map((item) => [item.id, item.label, item.description])).toEqual([
      ["cmd:handoff", "/handoff", "Continue in a new thread that keeps this conversation"],
      ["pcmd:handoff", "/handoff", "Write a handoff note"],
    ]);
    const providerItem = items[1];
    if (!providerItem) throw new Error("Expected the provider's /handoff");
    expect(
      resolveComposerCommandSelection({
        draftMessage: "/handoff",
        trigger: { rangeStart: 0, rangeEnd: 8 },
        item: providerItem,
        allowInteractionMode: true,
      }),
    ).toEqual({ text: "/handoff ", cursor: 9, interactionMode: null });
  });

  it("names the provider's /handoff when it has no description", () => {
    const items = buildComposerSlashCommandItems({
      query: "handoff",
      atMessageStart: true,
      hasThread: true,
      handoffDisabledReason: null,
      allowInteractionMode: true,
      selectedProviderStatus: codex([{ name: "handoff" }]),
    });
    expect(items[1]).toMatchObject({
      id: "pcmd:handoff",
      description: "The provider's own command",
    });
  });
});
