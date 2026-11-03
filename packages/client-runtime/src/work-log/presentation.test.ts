import { describe, expect, it } from "vite-plus/test";

import { ThreadId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  resolveWorkEntryAppActivity,
  resolveWorkEntryToolPresentation,
  summarizeToolGroup,
  toolItemForDisplay,
  type WorkLogPresentationEntry,
  workEntryIndicatesToolFailure,
  workEntryDisplayIndicatesToolFailure,
} from "./presentation.js";

function commandItem(
  fields: Partial<Extract<OrchestrationV2TurnItem, { type: "command_execution" }>> = {},
): OrchestrationV2TurnItem {
  return {
    id: TurnItemId.make("command"),
    threadId: ThreadId.make("thread"),
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: null,
    startedAt: null,
    completedAt: null,
    updatedAt: DateTime.makeUnsafe("2026-09-08T00:00:00.000Z"),
    type: "command_execution",
    input: 'rg "command not found"',
    exitCode: 0,
    ...fields,
  };
}

describe("workEntryIndicatesToolFailure", () => {
  const base = {
    id: "w1",
    createdAt: "2026-01-01T00:00:00.000Z",
    label: "Read",
  };

  it.each([
    [{ exitCode: 2 }, true],
    [{ output: "sh: missing-command: command not found" }, true],
    [{ output: `${"x".repeat(32_768)} command not found` }, false],
  ] as const)(
    "preserves command failure state after removing displayed output: %j",
    (fields, failed) => {
      const structuredPayload = commandItem(fields);
      const entry: WorkLogPresentationEntry = {
        ...base,
        tone: "tool",
        itemType: "command_execution",
        toolLifecycleStatus: "completed",
        structuredPayload,
      };
      expect(workEntryDisplayIndicatesToolFailure(entry)).toBe(failed);
      expect(JSON.stringify(toolItemForDisplay(structuredPayload))).not.toContain('"output":');
    },
  );

  it("ignores failure phrases in reasoning text", () => {
    const entry: WorkLogPresentationEntry = {
      ...base,
      label: "Thinking",
      tone: "thinking",
      itemType: "reasoning",
      toolLifecycleStatus: "completed",
      detail: "That exit code 2 is just from listing the deleted directory, which is expected.",
    };
    expect(workEntryIndicatesToolFailure(entry)).toBe(false);
    expect(workEntryDisplayIndicatesToolFailure(entry)).toBe(false);
  });

  it("does not treat error text in a command as rendered failure", () => {
    const entry = {
      ...base,
      label: "Ran command",
      tone: "tool",
      toolLifecycleStatus: "completed",
      command: 'rg "file not found"',
      detail: "Found 3 matches",
    } satisfies WorkLogPresentationEntry;

    expect(workEntryDisplayIndicatesToolFailure(entry)).toBe(false);

    expect(workEntryIndicatesToolFailure(entry)).toBe(true);
    expect(workEntryDisplayIndicatesToolFailure({ ...entry, detail: "File not found" })).toBe(true);
  });
});

describe("resolveWorkEntryToolPresentation", () => {
  it("shows returned MCP errors as failures even in the live activity row", () => {
    const entry: WorkLogPresentationEntry = {
      id: "clone",
      createdAt: "2026-09-19T00:00:00.000Z",
      tone: "tool",
      label: "T3-code.t3_project_clone",
      toolLifecycleStatus: "inProgress",
      itemType: "dynamic_tool",
      toolData: { output: { isError: true } },
    };
    expect(resolveWorkEntryToolPresentation(entry)?.displayName).toBe(
      "Failed to clone a repository",
    );
    expect(workEntryDisplayIndicatesToolFailure(entry)).toBe(true);
    const childFailure = {
      ...entry,
      label: "T3-code.task_status",
      toolLifecycleStatus: "completed" as const,
      toolData: { output: { taskId: "child", status: "failed", summary: "command not found" } },
    };
    expect(workEntryDisplayIndicatesToolFailure(childFailure)).toBe(false);
  });
  it.each([
    "mcp__t3-code__preview_click",
    "mcp__t3_code__preview_click",
    "mcp__t3code__preview_click",
    "T3-code.preview_click",
    "t3-code · preview_click completed",
    "t3_code/preview_click",
    "preview_click",
  ])("recognizes browser tool names across providers: %s", (label) => {
    expect(resolveWorkEntryToolPresentation({ label })).toEqual({
      displayName: "Clicking in the preview browser",
      icon: "browser",
    });
  });

  it("uses structured MCP identity when the provider supplies a custom title", () => {
    expect(
      resolveWorkEntryToolPresentation({
        label: "Tool call complete",
        toolTitle: "Inspect the current page",
        toolData: { server: "t3-code", tool: "preview_snapshot", result: { title: "Example" } },
      }),
    ).toEqual({ displayName: "Taking a snapshot of the preview page", icon: "browser" });
  });

  it("uses the summary's state only when the provider omitted a lifecycle status", () => {
    const entry = { label: "T3-code.preview_click" };
    expect(resolveWorkEntryToolPresentation(entry, "inProgress")?.displayName).toBe(
      "Clicking in the preview browser",
    );
    expect(resolveWorkEntryToolPresentation(entry, "completed")?.displayName).toBe(
      "Clicked in the preview browser",
    );
    expect(
      resolveWorkEntryToolPresentation({ ...entry, toolLifecycleStatus: "completed" }, "inProgress")
        ?.displayName,
    ).toBe("Clicked in the preview browser");
    expect(
      resolveWorkEntryToolPresentation({ ...entry, toolLifecycleStatus: "failed" }, "completed")
        ?.displayName,
    ).toBe("Failed to click in the preview browser");
  });

  it.each([
    ["https://github.com/acme/web/pull/7", "PR #7"],
    ["https://gitlab.com/acme/web/-/merge_requests/7", "MR #7"],
  ])("names a linked change request with its host's term (%s)", (url, target) => {
    expect(
      resolveWorkEntryToolPresentation({
        label: "T3-code.link_pull_request",
        toolLifecycleStatus: "completed",
        toolData: { arguments: { url } },
      })?.displayName,
    ).toMatch(new RegExp(` ${target}$`));
  });

  it("does not brand unknown tools or another server's matching tool name", () => {
    for (const label of [
      "mcp__github__preview_click",
      "t3-code.unknown_tool",
      "t3-code.toString",
      "Search files",
    ]) {
      expect(resolveWorkEntryToolPresentation({ label })).toBeNull();
    }
    expect(
      resolveWorkEntryToolPresentation({
        label: "preview_click",
        toolData: { server: "another-server", tool: "preview_click" },
      }),
    ).toBeNull();
  });
});

describe("resolveWorkEntryAppActivity", () => {
  it.each([
    [{ label: "mcp__editor_gmail_3f2a9c0d__search_threads" }, "Searching Gmail"],
    [
      {
        label: "Gmail search",
        toolData: { server: "gmail", tool: "search_threads", arguments: { query: "invoices" } },
      },
      "Searching Gmail",
    ],
    [
      { label: "uber.request_ride", toolLifecycleStatus: "completed" as const },
      "Requested an Uber",
    ],
  ])("brands connector tools across providers: %o", (fields, label) => {
    expect(resolveWorkEntryAppActivity({ ...fields })?.label).toBe(label);
  });

  it("reads the detail from structured arguments and leaves other tools alone", () => {
    expect(
      resolveWorkEntryAppActivity({
        label: "Gmail search",
        toolData: { server: "gmail", tool: "search_threads", arguments: { query: "invoices" } },
      })?.detail,
    ).toBe("invoices");
    expect(resolveWorkEntryAppActivity({ label: "T3-code.preview_click" })).toBeNull();
    expect(resolveWorkEntryAppActivity({ label: "Ran command" })).toBeNull();
  });

  it("reads Hermes connector calls, whose tool name carries the detail after a colon", () => {
    const activity = resolveWorkEntryAppActivity({
      label: "search messages",
      structuredPayload: {
        type: "dynamic_tool",
        toolName: "editor_gmail_63ea3519.search_messages: invoices from Acme",
        input: { query: "invoices from Acme" },
      } as never,
      toolLifecycleStatus: "completed",
    });
    expect(activity && [activity.brand.name, activity.label, activity.detail]).toEqual([
      "Gmail",
      "Searched Gmail",
      "invoices from Acme",
    ]);
  });
});

describe("summarizeToolGroup", () => {
  const sourced = (key: string, name: string) =>
    ({
      id: key,
      createdAt: "2026-11-03T00:00:00.000Z",
      label: name,
      tone: "tool",
      itemType: "dynamic_tool",
      toolSource: { key: `mcp:${key}`, name, kind: "integration" },
    }) as unknown as WorkLogPresentationEntry;

  it("names connector apps by brand instead of their renamed MCP servers", () => {
    const summary = summarizeToolGroup([
      sourced("editor_gmail_63ea3519", "editor gmail 63ea3519"),
      sourced("editor_uber_46f286a1", "editor uber 46f286a1"),
      sourced("editor_google_maps_0e4b678a", "editor google maps 0e4b678a"),
    ]).summary;
    expect(summary).toBe("Used Gmail, Uber, and Google Maps");
  });

  it("keeps the integration wording for servers that are not known apps", () => {
    expect(summarizeToolGroup([sourced("linear", "Linear")]).summary).toBe(
      "Used Linear integration",
    );
  });
});
