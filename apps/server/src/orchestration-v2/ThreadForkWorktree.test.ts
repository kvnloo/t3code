// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointRef,
  CommandId,
  type OrchestrationV2Command,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadProjection,
  type Project,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { OrchestratorDispatchError } from "./Orchestrator.ts";
import * as ThreadForkWorktree from "./ThreadForkWorktree.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

const projectId = ProjectId.make("project:fork-worktree");
const sourceThreadId = ThreadId.make("thread:fork-worktree-source");
const targetThreadId = ThreadId.make("thread:fork-worktree-target");
const forkRunId = RunId.make("run:fork-point");
const checkpointId = CheckpointId.make("checkpoint:fork-point");
const checkpointRef = CheckpointRef.make("refs/t3/orchestration-v2/checkpoints/test/ordinal/1");

const layerVcsProcess = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));
const layerVcs = VcsDriverRegistry.layer.pipe(
  Layer.provide(layerVcsProcess),
  Layer.provide(NodeServices.layer),
);
const layerCheckpointStore = CheckpointStore.layer.pipe(Layer.provide(layerVcs));

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const vcsProcess = yield* VcsProcess.VcsProcess;
    const result = yield* vcsProcess.run({
      operation: "ThreadForkWorktree.test.git",
      command: "git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
    return result.stdout.trim();
  }).pipe(Effect.provide(layerVcsProcess), Effect.orDie);

const read = (path: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return (yield* fileSystem.exists(path)) ? yield* fileSystem.readFileString(path) : null;
  }).pipe(Effect.orDie);

const write = (path: string, contents: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.writeFileString(path, contents);
  }).pipe(Effect.orDie);

/** A repository whose fork point (checkpoint) differs from the source's later state. */
const makeRepository = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const repo = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-fork-repo-" });
  const worktrees = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-fork-worktrees-" });
  yield* git(repo, ["init", "-b", "main"]);
  yield* git(repo, ["config", "user.email", "test@test.com"]);
  yield* git(repo, ["config", "user.name", "Test"]);
  yield* write(NodePath.join(repo, "a.txt"), "committed\n");
  yield* git(repo, ["add", "."]);
  yield* git(repo, ["commit", "-m", "initial"]);
  // The fork point: an uncommitted edit plus an untracked file, captured as the run's checkpoint.
  yield* write(NodePath.join(repo, "a.txt"), "fork point\n");
  yield* write(NodePath.join(repo, "new.txt"), "untracked at fork point\n");
  const checkpoints = yield* CheckpointStore.CheckpointStore;
  yield* checkpoints
    .captureCheckpoint({ cwd: repo, checkpointRef })
    .pipe(Effect.provide(layerCheckpointStore), Effect.orDie);
  // Later work in the source checkout, which the fork must not see.
  yield* write(NodePath.join(repo, "a.txt"), "later\n");
  yield* FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.remove(NodePath.join(repo, "new.txt"))),
    Effect.orDie,
  );
  yield* git(repo, ["commit", "-am", "later"]);
  return { repo, worktrees };
}).pipe(Effect.provide(layerCheckpointStore));

function makeProjection(withCheckpoint: boolean): OrchestrationV2ThreadProjection {
  // Only the fields ThreadForkWorktree reads; the rest of the projection is irrelevant here.
  return {
    thread: { id: sourceThreadId, projectId, worktreePath: null, branch: "main" },
    runs: [{ id: forkRunId, status: "completed", ordinal: 1, checkpointId }],
    checkpoints: withCheckpoint ? [{ id: checkpointId, runId: forkRunId, ref: checkpointRef }] : [],
  } as unknown as OrchestrationV2ThreadProjection;
}

const forkCommand = {
  type: "thread.fork",
  commandId: CommandId.make("command:fork-worktree"),
  sourceThreadId,
  targetThreadId,
  sourcePoint: { type: "run", runId: forkRunId },
  workspace: { type: "new_worktree" },
  createdBy: "user",
  creationSource: "web",
} satisfies Extract<OrchestrationV2Command, { readonly type: "thread.fork" }>;

function makeLayer(input: {
  readonly repo: string;
  readonly worktrees: string;
  readonly withCheckpoint: boolean;
  readonly dispatched: Array<OrchestrationV2ServerCommand>;
  readonly failDispatch?: boolean;
}) {
  return ThreadForkWorktree.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          getThreadRecords: () => Effect.succeed(makeProjection(input.withCheckpoint)),
          dispatch: (command) => {
            input.dispatched.push(command);
            return input.failDispatch
              ? Effect.fail(
                  new OrchestratorDispatchError({
                    commandId: command.commandId,
                    commandType: command.type,
                    cause: "rejected",
                  }),
                )
              : Effect.succeed({ sequence: 1, storedEvents: [] });
          },
        } satisfies Partial<ThreadManagementService.ThreadManagementService["Service"]>),
        Layer.mock(ProjectService.ProjectService)({
          getById: () =>
            Effect.succeedSome({
              id: projectId,
              workspaceRoot: input.repo,
              scripts: [],
            } as unknown as Project),
        } satisfies Partial<ProjectService.ProjectService["Service"]>),
        // Real git, without GitManager's settings and progress plumbing.
        Layer.mock(GitWorkflowService.GitWorkflowService)({
          hasCommit: () => Effect.succeed(false),
          createWorktree: (create) =>
            Effect.gen(function* () {
              const path = NodePath.join(input.worktrees, create.newRefName!.replace(/\//g, "-"));
              yield* git(create.cwd, [
                "worktree",
                "add",
                "-b",
                create.newRefName!,
                path,
                create.refName,
              ]);
              return { worktree: { path, refName: create.newRefName! } };
            }),
          removeWorktree: (remove) =>
            git(remove.cwd, ["worktree", "remove", "--force", remove.path]).pipe(Effect.asVoid),
          deleteLocalBranch: (remove) =>
            git(remove.cwd, ["branch", "-D", remove.refName]).pipe(Effect.asVoid),
        } satisfies Partial<GitWorkflowService.GitWorkflowService["Service"]>),
        Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
          runForThread: () => Effect.succeed({ status: "no-script" } as const),
        } satisfies Partial<ProjectSetupScriptRunner.ProjectSetupScriptRunner["Service"]>),
        layerVcs,
        NodeServices.layer,
      ),
    ),
  );
}

describe("ThreadForkWorktree", () => {
  it.effect("forks into a distinct worktree holding the checkpoint's files, not later edits", () =>
    Effect.gen(function* () {
      const { repo, worktrees } = yield* makeRepository;
      const dispatched: Array<OrchestrationV2ServerCommand> = [];
      const result = yield* Effect.gen(function* () {
        const forks = yield* ThreadForkWorktree.ThreadForkWorktree;
        return yield* forks.fork(forkCommand);
      }).pipe(Effect.provide(makeLayer({ repo, worktrees, withCheckpoint: true, dispatched })));

      assert.strictEqual(result.restoredFrom, "checkpoint");
      assert.notStrictEqual(result.worktreePath, repo);
      assert.notStrictEqual(result.branch, "main");
      assert.strictEqual(
        yield* git(result.worktreePath, ["branch", "--show-current"]),
        result.branch,
      );
      assert.strictEqual(yield* read(NodePath.join(result.worktreePath, "a.txt")), "fork point\n");
      assert.strictEqual(
        yield* read(NodePath.join(result.worktreePath, "new.txt")),
        "untracked at fork point\n",
      );
      // The branch starts at the HEAD the checkpoint was captured on; fork-point edits stay uncommitted.
      assert.strictEqual(
        yield* git(result.worktreePath, ["rev-parse", "HEAD"]),
        yield* git(repo, ["rev-parse", "HEAD~1"]),
      );
      // The source checkout keeps its later work.
      assert.strictEqual(yield* read(NodePath.join(repo, "a.txt")), "later\n");
      assert.strictEqual(yield* read(NodePath.join(repo, "new.txt")), null);
      assert.deepStrictEqual(
        dispatched.map((command) => command.type === "thread.fork" && command.workspace),
        [{ type: "existing_worktree", worktreePath: result.worktreePath, branch: result.branch }],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("without a checkpoint, forks from the source's HEAD and says so", () =>
    Effect.gen(function* () {
      const { repo, worktrees } = yield* makeRepository;
      const dispatched: Array<OrchestrationV2ServerCommand> = [];
      const result = yield* Effect.gen(function* () {
        const forks = yield* ThreadForkWorktree.ThreadForkWorktree;
        return yield* forks.fork(forkCommand);
      }).pipe(Effect.provide(makeLayer({ repo, worktrees, withCheckpoint: false, dispatched })));

      assert.strictEqual(result.restoredFrom, "head");
      assert.strictEqual(yield* read(NodePath.join(result.worktreePath, "a.txt")), "later\n");
      assert.strictEqual(yield* read(NodePath.join(result.worktreePath, "new.txt")), null);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("removes the worktree and branch when the fork is rejected", () =>
    Effect.gen(function* () {
      const { repo, worktrees } = yield* makeRepository;
      const dispatched: Array<OrchestrationV2ServerCommand> = [];
      const exit = yield* Effect.gen(function* () {
        const forks = yield* ThreadForkWorktree.ThreadForkWorktree;
        return yield* forks.fork(forkCommand);
      }).pipe(
        Effect.provide(
          makeLayer({ repo, worktrees, withCheckpoint: true, dispatched, failDispatch: true }),
        ),
        Effect.exit,
      );

      assert.isTrue(Exit.isFailure(exit));
      assert.strictEqual(dispatched.length, 1);
      assert.strictEqual(
        yield* git(repo, ["worktree", "list", "--porcelain"]).pipe(
          Effect.map(
            (list) => list.split("\n").filter((line) => line.startsWith("worktree ")).length,
          ),
        ),
        1,
      );
      assert.strictEqual(yield* git(repo, ["branch", "--list", "t3code/*"]), "");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses a side chat before touching git", () =>
    Effect.gen(function* () {
      const { repo, worktrees } = yield* makeRepository;
      const dispatched: Array<OrchestrationV2ServerCommand> = [];
      const exit = yield* Effect.gen(function* () {
        const forks = yield* ThreadForkWorktree.ThreadForkWorktree;
        return yield* forks.fork({ ...forkCommand, sideChat: true });
      }).pipe(
        Effect.provide(makeLayer({ repo, worktrees, withCheckpoint: true, dispatched })),
        Effect.exit,
      );

      assert.isTrue(Exit.isFailure(exit));
      assert.strictEqual(dispatched.length, 0);
      assert.strictEqual(yield* git(repo, ["branch", "--list", "t3code/*"]), "");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
