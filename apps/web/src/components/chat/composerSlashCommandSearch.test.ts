import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { parseSideChatCommand } from "../../composer-logic";
import {
  describeProviderCommandsShadowingBuiltIns,
  handoffSlashCommandItems,
  searchSlashCommandItems,
  slashCommandItemsForPromptPosition,
} from "./composerSlashCommandSearch";

const codex = ProviderDriverKind.make("codex");

function providerItem(name: string, description?: string) {
  return {
    id: `provider-slash-command:${codex}:${name}`,
    type: "provider-slash-command" as const,
    provider: codex,
    command: description === undefined ? { name } : { name, description },
    label: `/${name}`,
    description: description ?? "Run provider command",
  };
}

describe("web /handoff", () => {
  it("is offered with its description, or why it cannot run yet", () => {
    expect(handoffSlashCommandItems({ available: false, disabledReason: null })).toEqual([]);
    expect(handoffSlashCommandItems({ available: true, disabledReason: null })).toEqual([
      {
        id: "slash:handoff",
        type: "slash-command",
        command: "handoff",
        label: "/handoff",
        description: "Continue in a new thread that keeps this conversation",
      },
    ]);
    expect(
      handoffSlashCommandItems({
        available: true,
        disabledReason: "Hand off after the first reply finishes.",
      })[0]?.description,
    ).toBe("Hand off after the first reply finishes.");
  });

  it("works only at the start of a message", () => {
    const items = handoffSlashCommandItems({ available: true, disabledReason: null });
    expect(slashCommandItemsForPromptPosition(items, true)).toHaveLength(1);
    expect(slashCommandItemsForPromptPosition(items, false)).toEqual([]);
  });

  it("lists T3's /handoff first and keeps the provider's /handoff reachable", () => {
    const builtIns = handoffSlashCommandItems({ available: true, disabledReason: null });
    const providerItems = describeProviderCommandsShadowingBuiltIns(
      [providerItem("handoff", "Write a handoff note"), providerItem("review")],
      builtIns,
    );
    const ranked = searchSlashCommandItems([...providerItems, ...builtIns], "handoff");
    expect(ranked.map((item) => [item.id, item.description])).toEqual([
      ["slash:handoff", "Continue in a new thread that keeps this conversation"],
      ["provider-slash-command:codex:handoff", "Write a handoff note"],
    ]);
  });

  it("names the provider's /handoff when it has no description", () => {
    const builtIns = handoffSlashCommandItems({ available: true, disabledReason: null });
    const [handoff, review] = describeProviderCommandsShadowingBuiltIns(
      [providerItem("handoff"), providerItem("review")],
      builtIns,
    );
    expect(handoff?.description).toBe("The provider's own command");
    expect(review?.description).toBe("Run provider command");
    // Without T3's /handoff on offer, the provider's keeps its own label.
    expect(
      describeProviderCommandsShadowingBuiltIns([providerItem("handoff")], [])[0]?.description,
    ).toBe("Run provider command");
  });

  it("is not a side chat", () => {
    expect(parseSideChatCommand("/handoff tests")).toBeNull();
  });
});
