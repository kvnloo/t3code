import { describe, expect, it } from "vite-plus/test";

import { resolveProviderIconIdentity, resolveProviderIconImage } from "./providerIconIdentity";

const officialIcon = "https://cdn.agentclientprotocol.com/registry/v1/latest/goose.svg";

describe("resolveProviderIconIdentity", () => {
  it("uses executable identity independently of profile and display names", () => {
    for (const commandPath of [
      "hermes",
      "/home/user/.local/bin/hermes",
      "C:\\bin\\hermes.exe",
      "/home/user/.local/bin/hermes-acp",
      "C:\\bin\\hermes-acp.exe",
    ]) {
      expect(
        resolveProviderIconIdentity({
          driver: "acpRegistry",
          settings: { source: "local", commandPath, commandArgs: ["--profile", "clean", "acp"] },
        }),
      ).toBe("hermes");
    }
    expect(
      resolveProviderIconIdentity({
        driver: "acpRegistry",
        settings: { source: "registry", agentId: "hermes" },
      }),
    ).toBe("hermes");
  });

  it("does not identify arbitrary ACP agents, labels, models or command arguments as Hermes", () => {
    for (const settings of [
      undefined,
      null,
      "hermes",
      { source: "local", commandPath: "goose", displayName: "Hermes", model: "hermes" },
      { source: "local", commandPath: "sh", commandArgs: ["hermes acp"] },
      { source: "local", commandPath: "not-hermes" },
      { source: "local", commandPath: "hermes-acp-clean" },
      { source: "registry", agentId: "goose", commandPath: "hermes" },
    ]) {
      expect(resolveProviderIconIdentity({ driver: "acpRegistry", settings })).toBeNull();
    }
    expect(
      resolveProviderIconIdentity({
        driver: "codex",
        settings: { source: "local", commandPath: "hermes" },
      }),
    ).toBeNull();
  });
});

describe("resolveProviderIconImage", () => {
  it("keeps the fallback until the current official image loads, and on failure", () => {
    expect(resolveProviderIconImage(officialIcon, null)).toEqual({
      iconUrl: officialIcon,
      loaded: false,
      failed: false,
    });
    expect(
      resolveProviderIconImage(officialIcon, { iconUrl: officialIcon, status: "loaded" }).loaded,
    ).toBe(true);
    expect(
      resolveProviderIconImage(officialIcon, { iconUrl: officialIcon, status: "failed" }).failed,
    ).toBe(true);
    expect(
      resolveProviderIconImage(officialIcon, { iconUrl: `${officialIcon}?old`, status: "loaded" })
        .loaded,
    ).toBe(false);
    expect(
      resolveProviderIconImage(officialIcon, { iconUrl: `${officialIcon}?old`, status: "failed" })
        .failed,
    ).toBe(false);
  });

  it("rejects unofficial URLs and missing sources", () => {
    for (const iconUrl of [
      undefined,
      null,
      "file:///hermes.svg",
      "https://example.com/hermes.svg",
      "https://cdn.agentclientprotocol.com.evil.test/hermes.svg",
    ]) {
      expect(resolveProviderIconImage(iconUrl, null)).toEqual({
        iconUrl: null,
        loaded: false,
        failed: false,
      });
    }
  });
});
