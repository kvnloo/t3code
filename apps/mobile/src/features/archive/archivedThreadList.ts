import type { ArchivedSnapshotEntry } from "@t3tools/client-runtime/state/threads";
import {
  scopeProject,
  scopeThreadShell,
  type EnvironmentProject,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";

import { scopedProjectKey } from "../../lib/scopedEntities";
import { rankMobileThreadMatches } from "../threads/mobileThreadSearch";

export type ArchivedThreadSortOrder = "newest" | "oldest";

export interface ArchivedThreadGroup {
  readonly key: string;
  readonly project: EnvironmentProject;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}

interface ArchivedCandidate {
  readonly project: EnvironmentProject;
  readonly thread: EnvironmentThreadShell;
  readonly environmentLabel: string | null;
}

function archiveTimestamp(thread: EnvironmentThreadShell): number {
  const timestamp = Date.parse(thread.archivedAt ?? thread.updatedAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function buildArchivedThreadGroups(input: {
  readonly snapshots: ReadonlyArray<ArchivedSnapshotEntry>;
  readonly environmentLabels: Readonly<Record<string, string>>;
  readonly environmentId: EnvironmentId | null;
  readonly searchQuery: string;
  readonly sortOrder: ArchivedThreadSortOrder;
}): ReadonlyArray<ArchivedThreadGroup> {
  const candidates: ArchivedCandidate[] = [];
  for (const entry of input.snapshots) {
    if (input.environmentId !== null && input.environmentId !== entry.environmentId) continue;
    const environmentLabel = input.environmentLabels[entry.environmentId] ?? null;
    const threadsByProjectId = new Map<string, EnvironmentThreadShell[]>();
    for (const rawThread of entry.snapshot.threads) {
      if (rawThread.archivedAt === null) continue;
      const threads = threadsByProjectId.get(rawThread.projectId) ?? [];
      threads.push(scopeThreadShell(entry.environmentId, rawThread));
      threadsByProjectId.set(rawThread.projectId, threads);
    }

    for (const rawProject of entry.snapshot.projects) {
      const project = scopeProject(entry.environmentId, rawProject);
      for (const thread of threadsByProjectId.get(project.id) ?? []) {
        candidates.push({ project, thread, environmentLabel });
      }
    }
  }

  const searching = input.searchQuery.trim().length > 0;
  const ranked = rankMobileThreadMatches(candidates, input.searchQuery, (candidate) => ({
    title: candidate.thread.title,
    project: candidate.project.title,
    branch: candidate.thread.branch,
    workspaceRoot: candidate.project.workspaceRoot,
    environmentLabel: candidate.environmentLabel,
    activityAt: candidate.thread.updatedAt,
  }));
  const groupsByKey = new Map<string, { key: string; project: EnvironmentProject; threads: EnvironmentThreadShell[] }>();
  for (const { item } of ranked) {
    const key = scopedProjectKey(item.project.environmentId, item.project.id);
    let group = groupsByKey.get(key);
    if (group === undefined) {
      group = { key, project: item.project, threads: [] };
      groupsByKey.set(key, group);
    }
    group.threads.push(item.thread);
  }

  const groups = [...groupsByKey.values()];
  if (searching) return groups;

  const timestampOrder = input.sortOrder === "newest" ? Order.flip(Order.Number) : Order.Number;
  return Arr.sort(
    groups.map((group) => ({
      ...group,
      threads: Arr.sort(
        group.threads,
        Order.mapInput(
          Order.Struct({ timestamp: timestampOrder, title: Order.String, id: Order.String }),
          (thread: EnvironmentThreadShell) => ({
            timestamp: archiveTimestamp(thread),
            title: thread.title,
            id: thread.id,
          }),
        ),
      ),
    })),
    Order.mapInput(
      Order.Struct({ timestamp: timestampOrder, title: Order.String, key: Order.String }),
      (group: ArchivedThreadGroup) => ({
        timestamp: group.threads[0] ? archiveTimestamp(group.threads[0]) : 0,
        title: group.project.title,
        key: group.key,
      }),
    ),
  );
}
