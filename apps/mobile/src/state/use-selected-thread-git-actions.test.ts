import { describe, expect, it } from "vite-plus/test";

import { selectedThreadGitRefreshIdentity } from "./selected-thread-git-refresh";

describe("selectedThreadGitRefreshIdentity", () => {
  const base = {
    environmentId: "env-1",
    threadId: "thread-1",
    projectId: "project-1",
    cwd: "/repo",
    branch: "main",
  };

  it("is stable while unrelated thread shell fields change", () => {
    expect(selectedThreadGitRefreshIdentity(base)).toBe(
      selectedThreadGitRefreshIdentity({ ...base }),
    );
  });

  it("changes only with the selected git target identity", () => {
    const current = selectedThreadGitRefreshIdentity(base);
    expect(selectedThreadGitRefreshIdentity({ ...base, threadId: "thread-2" })).not.toBe(current);
    expect(selectedThreadGitRefreshIdentity({ ...base, cwd: "/repo-worktree" })).not.toBe(current);
    expect(selectedThreadGitRefreshIdentity({ ...base, branch: "feature" })).not.toBe(current);
    expect(selectedThreadGitRefreshIdentity({ ...base, environmentId: "env-2" })).not.toBe(current);
  });

  it("does not produce a refresh key before selection is complete", () => {
    expect(selectedThreadGitRefreshIdentity({ ...base, threadId: null })).toBeNull();
    expect(selectedThreadGitRefreshIdentity({ ...base, cwd: null })).toBeNull();
    expect(selectedThreadGitRefreshIdentity({ ...base, projectId: null })).toBeNull();
  });
});
