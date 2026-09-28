export function selectedThreadGitRefreshIdentity(input: {
  readonly environmentId: string | null;
  readonly threadId: string | null;
  readonly projectId: string | null;
  readonly cwd: string | null;
  readonly branch: string | null;
}): string | null {
  if (!input.environmentId || !input.threadId || !input.projectId || !input.cwd) {
    return null;
  }
  return JSON.stringify([
    input.environmentId,
    input.threadId,
    input.projectId,
    input.cwd,
    input.branch,
  ]);
}
