import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  needsYouAwaitsDecision,
  needsYouQueue,
  nextNeedsYouKey,
} from "@t3tools/client-runtime/state/needs-you";
import { canSnooze } from "@t3tools/client-runtime/state/thread-settled";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  InboxIcon,
  MessageSquareIcon,
} from "lucide-react";
import { useState } from "react";
import { create } from "zustand";
import {
  useProjects,
  useQuietThreadShells,
  useAllEnvironmentShellsBootstrapped,
} from "../state/entities";
import { useEnvironmentScope } from "../state/session";
import { useThreadActions } from "../hooks/useThreadActions";
import { buildThreadRouteParams } from "../threadRoutes";
import { useNowMinute } from "../hooks/useNowMinute";
import ChatView from "./ChatView";
import { WorkspacePageHeader } from "./WorkspacePageHeader";
import { Button } from "./ui/button";
import { SidebarInset } from "./ui/sidebar";

type QueueCursor = { selected: string | null; keys: readonly string[] };
const useNeedsYouFilter = create<{
  project: string;
  resume: QueueCursor;
  remember: (resume: QueueCursor) => void;
  setProject: (project: string) => void;
}>((set) => ({
  project: "all",
  resume: { selected: null, keys: [] },
  remember: (resume) => set({ resume }),
  setProject: (project) => set({ project, resume: { selected: null, keys: [] } }),
}));

export function NeedsYouPage() {
  const threads = useQuietThreadShells();
  const projects = useProjects();
  const ready = useAllEnvironmentShellsBootstrapped();
  const now = useNowMinute();
  const { project, resume, remember, setProject } = useNeedsYouFilter();
  const navigate = useNavigate();
  const queue = needsYouQueue(threads, now).filter(
    ({ thread }) => project === "all" || `${thread.environmentId}:${thread.projectId}` === project,
  );
  const keys = queue.map((entry) => entry.key);
  const [cursor, setCursor] = useState<QueueCursor>(resume);
  const selected = nextNeedsYouKey(keys, cursor.selected, cursor.keys);
  if (cursor.selected !== selected || cursor.keys.join("\n") !== keys.join("\n"))
    setCursor({ selected, keys });
  const entry = queue.find((item) => item.key === selected);
  const index = entry ? keys.indexOf(entry.key) : -1;
  const selectedProject = entry
    ? projects.find(
        (item) =>
          item.environmentId === entry.thread.environmentId && item.id === entry.thread.projectId,
      )
    : null;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <WorkspacePageHeader>
        <InboxIcon className="size-4 shrink-0" />
        <h1 className="text-sm font-medium">Needs you</h1>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {ready ? queue.length : "Loading…"}
        </span>
        <div className="ml-auto min-w-0 max-w-48">
          <select
            aria-label="Filter Needs you by project"
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
            value={project}
            onChange={(event) => {
              setProject(event.target.value);
              setCursor({ selected: null, keys: [] });
            }}
          >
            <option value="all">All projects</option>
            {projects.map((item) => (
              <option
                key={`${item.environmentId}:${item.id}`}
                value={`${item.environmentId}:${item.id}`}
              >
                {item.title}
              </option>
            ))}
          </select>
        </div>
      </WorkspacePageHeader>
      {entry ? (
        <>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                {selectedProject?.title ?? "Project"} · {entry.reason}
                {entry.thread.pinnedAt ? " · Pinned" : ""}
              </p>
              <p className="max-w-xl truncate text-sm font-medium">{entry.thread.title}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Previous decision"
                disabled={index <= 0}
                onClick={() => setCursor({ selected: keys[index - 1] ?? null, keys })}
              >
                <ArrowLeftIcon />
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {index + 1} / {queue.length}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Next decision"
                disabled={index === queue.length - 1}
                onClick={() => setCursor({ selected: keys[index + 1] ?? null, keys })}
              >
                <ArrowRightIcon />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  remember({ selected, keys });
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: buildThreadRouteParams(
                      scopeThreadRef(entry.thread.environmentId, entry.thread.id),
                    ),
                  });
                }}
              >
                <MessageSquareIcon />
                Open thread
              </Button>
              <NeedsYouActions key={entry.key} thread={entry.thread} />
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col" key={entry.key}>
            <ChatView
              environmentId={entry.thread.environmentId}
              threadId={entry.thread.id}
              routeKind="server"
              decisionFirst
            />
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <InboxIcon className="size-8 text-muted-foreground" />
          <h2 className="text-xl font-medium">
            {ready ? "Nothing needs you" : "Loading your inbox…"}
          </h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            {ready
              ? "Agents can keep working. Questions, approvals and results will appear here when they need your attention."
              : "Waiting for your connected environments."}
          </p>
          <Button variant="outline" onClick={() => void navigate({ to: "/" })}>
            Back to workspace
          </Button>
        </div>
      )}
    </SidebarInset>
  );
}

function NeedsYouActions({
  thread,
}: {
  thread: ReturnType<typeof needsYouQueue>[number]["thread"];
}) {
  const now = useNowMinute();
  const canOperate = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const { settleThread, snoozeThread } = useThreadActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = scopeThreadRef(thread.environmentId, thread.id);
  const awaiting = needsYouAwaitsDecision(thread);
  const act = async (action: "settle" | "snooze") => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        action === "settle"
          ? await settleThread(ref)
          : await snoozeThread(ref, new Date(Date.now() + 60 * 60 * 1000).toISOString());
      if (result._tag === "Failure")
        setError("Could not update this thread. It remains in your inbox.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={!canOperate || busy || !canSnooze(thread, { now })}
        onClick={() => void act("snooze")}
      >
        <ClockIcon />
        Later · 1h
      </Button>
      <Button
        size="sm"
        disabled={!canOperate || busy || awaiting}
        onClick={() => void act("settle")}
      >
        <CheckIcon />
        Reviewed
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}
