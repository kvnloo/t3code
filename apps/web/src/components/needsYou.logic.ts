import type { TimelineEntry } from "../session-logic";

export function decisionTimeline(entries: readonly TimelineEntry[]) {
  const latestUser = entries.findLastIndex(
    (entry) => entry.kind === "message" && entry.message.role === "user",
  );
  const latestAssistant = entries.findLastIndex(
    (entry) => entry.kind === "message" && entry.message.role === "assistant",
  );
  return entries.filter(
    (entry, index) =>
      (index === latestAssistant && index > latestUser) ||
      (index > latestUser &&
        (entry.kind === "proposed-plan" ||
          entry.kind === "html-render" ||
          entry.kind === "mcp-app")),
  );
}
