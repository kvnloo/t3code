import type { ToolLifecycleItemType } from "@t3tools/contracts";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeCommandValue(value: unknown): string | undefined {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const entry of value) {
    const part = asTrimmedString(entry);
    if (part !== undefined) {
      parts.push(part);
    }
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function stripTrailingExitCode(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = /^(?<output>[\s\S]*?)(?:\s*<exited with exit code \d+>)\s*$/iu.exec(trimmed);
  const output = match?.groups?.output?.trim() ?? trimmed;
  return output.length > 0 ? output : undefined;
}

function extractCommandFromTitle(title: string | undefined): string | undefined {
  if (!title) {
    return undefined;
  }
  const backtickMatch = /`([^`]+)`/u.exec(title);
  return backtickMatch?.[1]?.trim() || undefined;
}

function extractToolCommand(data: Record<string, unknown> | undefined, title: string | undefined) {
  const item = asRecord(data?.item);
  const itemInput = asRecord(item?.input);
  const itemResult = asRecord(item?.result);
  const rawInput = asRecord(data?.rawInput);
  const candidates = [
    normalizeCommandValue(item?.command),
    normalizeCommandValue(itemInput?.command),
    normalizeCommandValue(itemResult?.command),
    normalizeCommandValue(data?.command),
    normalizeCommandValue(rawInput?.command),
  ];
  const direct = candidates.find((candidate) => candidate !== undefined);
  if (direct) {
    return direct;
  }
  const executable = asTrimmedString(rawInput?.executable);
  const args = normalizeCommandValue(rawInput?.args);
  if (executable && args) {
    return `${executable} ${args}`;
  }
  if (executable) {
    return executable;
  }
  return extractCommandFromTitle(title);
}

function maybePathLike(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (
    value.includes("/") ||
    value.includes("\\") ||
    value.startsWith(".") ||
    /\.(?:[a-z0-9]{1,12})$/iu.test(value)
  ) {
    return value;
  }
  return undefined;
}

function collectPaths(value: unknown, paths: string[], seen: Set<string>, depth: number): void {
  if (depth > 4 || paths.length >= 8) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPaths(entry, paths, seen, depth + 1);
      if (paths.length >= 8) {
        return;
      }
    }
    return;
  }
  const record = asRecord(value);
  if (!record) {
    return;
  }
  for (const key of ["path", "filePath", "relativePath", "filename", "newPath", "oldPath"]) {
    const candidate = maybePathLike(asTrimmedString(record[key]));
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    paths.push(candidate);
    if (paths.length >= 8) {
      return;
    }
  }
  for (const nestedKey of ["locations", "item", "input", "result", "rawInput", "data", "changes"]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectPaths(record[nestedKey], paths, seen, depth + 1);
    if (paths.length >= 8) {
      return;
    }
  }
}

function extractPrimaryPath(data: Record<string, unknown> | undefined): string | undefined {
  const paths: string[] = [];
  collectPaths(data, paths, new Set<string>(), 0);
  return paths[0];
}

function normalizeEquivalentValue(value: string | undefined): string | undefined {
  const trimmed = asTrimmedString(value);
  if (!trimmed) {
    return undefined;
  }
  return trimmed
    .replace(/\s+/gu, " ")
    .replace(/\s+(?:complete|completed|started)\s*$/iu, "")
    .trim();
}

function isEquivalent(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeEquivalentValue(left)?.toLowerCase();
  const normalizedRight = normalizeEquivalentValue(right)?.toLowerCase();
  return normalizedLeft !== undefined && normalizedLeft === normalizedRight;
}

function normalizedToolName(data: Record<string, unknown> | undefined): string | undefined {
  const item = asRecord(data?.item);
  const raw = asTrimmedString(data?.toolName ?? data?.tool ?? item?.tool);
  return raw
    ?.split(/__|[./]/u)
    .at(-1)
    ?.replace(/[_\s-]/gu, "")
    .toLowerCase();
}

function displayToolName(data: Record<string, unknown> | undefined): string | undefined {
  const item = asRecord(data?.item);
  const raw = asTrimmedString(data?.toolName ?? data?.tool ?? item?.tool);
  const leaf = raw?.split(/__|[./]/u).at(-1)?.trim();
  if (!leaf) return undefined;
  const spaced = leaf.replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim();
  return spaced.length > 0 ? `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}` : undefined;
}

function classifyToolAction(input: {
  readonly itemType?: ToolLifecycleItemType | null | undefined;
  readonly title?: string | undefined;
  readonly data?: Record<string, unknown> | undefined;
}): "command" | "read" | "file_change" | "search" | "web_search" | "other" {
  const itemType = input.itemType ?? undefined;
  const kind = asTrimmedString(input.data?.kind)?.toLowerCase();
  const title = asTrimmedString(input.title)?.toLowerCase();
  const toolName = normalizedToolName(input.data);
  if (
    itemType === "command_execution" ||
    kind === "execute" ||
    title === "terminal" ||
    toolName === "bash" ||
    toolName === "shell" ||
    toolName === "terminal" ||
    toolName === "execute" ||
    toolName === "command"
  ) {
    return "command";
  }
  if (kind === "read" || title === "read file" || toolName === "read" || toolName === "readfile") {
    return "read";
  }
  if (
    itemType === "file_change" ||
    kind === "edit" ||
    kind === "move" ||
    kind === "delete" ||
    kind === "write" ||
    toolName === "edit" ||
    toolName === "write" ||
    toolName === "applypatch" ||
    toolName === "move" ||
    toolName === "delete"
  ) {
    return "file_change";
  }
  if (itemType === "web_search" || toolName === "websearch") {
    return "web_search";
  }
  if (
    kind === "search" ||
    title === "find" ||
    title === "grep" ||
    toolName === "grep" ||
    toolName === "glob" ||
    toolName === "find" ||
    toolName === "search"
  ) {
    return "search";
  }
  return "other";
}

export interface ToolActivityPresentationInput {
  readonly itemType?: ToolLifecycleItemType | null | undefined;
  readonly title?: string | null | undefined;
  readonly detail?: string | null | undefined;
  readonly data?: unknown;
  readonly fallbackSummary?: string | null | undefined;
}

export interface ToolActivityPresentation {
  readonly summary: string;
  readonly detail?: string | undefined;
}

export function deriveToolActivityPresentation(
  input: ToolActivityPresentationInput,
): ToolActivityPresentation {
  const title = asTrimmedString(input.title);
  const detail = stripTrailingExitCode(asTrimmedString(input.detail));
  const fallbackSummary = asTrimmedString(input.fallbackSummary) ?? "Tool";
  const data = asRecord(input.data);
  const toolName = displayToolName(data);
  const command = extractToolCommand(data, title);
  const primaryPath = extractPrimaryPath(data);
  const action = classifyToolAction({
    itemType: input.itemType,
    title,
    data,
  });

  if (action === "command") {
    return {
      summary: "Ran command",
      ...(command ? { detail: command } : {}),
    };
  }

  if (action === "read") {
    if (primaryPath) {
      return {
        summary: "Read file",
        detail: primaryPath,
      };
    }
    return {
      summary: "Read file",
    };
  }

  if (action === "file_change") {
    return {
      summary: "Changed files",
      ...(primaryPath ? { detail: primaryPath } : {}),
    };
  }

  if (action === "search" || action === "web_search") {
    const rawInput = asRecord(data?.rawInput) ?? asRecord(data?.input);
    const query =
      asTrimmedString(rawInput?.query) ??
      asTrimmedString(rawInput?.pattern) ??
      asTrimmedString(rawInput?.searchTerm);
    return {
      summary: action === "web_search" ? "Searched the web" : "Searched files",
      ...(query ? { detail: query } : {}),
    };
  }

  const identity = title ?? toolName ?? fallbackSummary;
  if (detail && !isEquivalent(detail, identity) && !isEquivalent(detail, fallbackSummary)) {
    return {
      summary: identity,
      detail,
    };
  }

  return {
    summary: identity,
  };
}

export function projectQuestionToolInput(data: Record<string, unknown>, title: unknown) {
  const item = asRecord(data.item);
  const toolName = data.toolName ?? data.tool ?? item?.tool ?? title;
  if (typeof toolName !== "string") return {};
  const name = toolName
    .split(/__|[./]/)
    .at(-1)
    ?.replace(/[_\s]/g, "")
    .toLowerCase();
  if (!name || !/^(askuserquestion|requestuserinput(?:async)?|askquestion|question)$/.test(name))
    return {};
  const input = asRecord(
    data.input ?? data.rawInput ?? asRecord(data.state)?.input ?? item?.arguments,
  );
  const questions = input?.questions ?? asRecord(input?.params)?.questions;
  if (!Array.isArray(questions)) return {};
  // Clients match native tools to the canonical question; choices and answers
  // already live on the user-input activities and need not cross the wire twice.
  return {
    toolName,
    input: {
      questions: questions.map((value) => {
        const question = asRecord(value);
        return {
          question: asTrimmedString(
            question?.question ?? question?.question_text ?? question?.prompt ?? question?.title,
          ),
        };
      }),
    },
  };
}
