import { describe, expect, it } from "vite-plus/test";

import { deriveToolActivityPresentation } from "./toolActivity.ts";

describe("toolActivity", () => {
  it("normalizes command tools to a stable ran-command label", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "command_execution",
        title: "Terminal",
        detail: "Terminal",
        data: {
          command: "bun run lint",
        },
        fallbackSummary: "Terminal",
      }),
    ).toEqual({
      summary: "Ran command",
      detail: "bun run lint",
    });
  });

  it("uses structured file paths for read-file tools when available", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        title: "Read File",
        detail: "Read File",
        data: {
          kind: "read",
          locations: [{ path: "/tmp/app.ts" }],
        },
        fallbackSummary: "Read File",
      }),
    ).toEqual({
      summary: "Read file",
      detail: "/tmp/app.ts",
    });
  });

  it.each([
    ["Bash", "command_execution", "Ran command"],
    ["Read", "dynamic_tool_call", "Read file"],
    ["Edit", "dynamic_tool_call", "Changed files"],
    ["Grep", "dynamic_tool_call", "Searched files"],
    ["WebSearch", "web_search", "Searched the web"],
  ] as const)("uses provider toolName when title is absent: %s", (toolName, itemType, summary) => {
    expect(
      deriveToolActivityPresentation({
        itemType,
        data: { toolName },
        fallbackSummary: "Tool updated",
      }),
    ).toEqual({ summary });
  });

  it("keeps an unknown provider tool name instead of degrading to Tool", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        data: { toolName: "custom_analyzer" },
        fallbackSummary: "Tool",
      }),
    ).toEqual({ summary: "Custom analyzer" });
  });

  it("drops duplicated generic read-file detail when no path is available", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        title: "Read File",
        detail: "Read File",
        data: {
          kind: "read",
          rawInput: {},
        },
        fallbackSummary: "Read File",
      }),
    ).toEqual({
      summary: "Read file",
    });
  });
});
