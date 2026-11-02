import { type OrchestrationV2Command, type ProjectId, ThreadId } from "@t3tools/contracts";
import {
  buildTemporaryWorktreeBranchName,
  flattenTemporaryWorktreeBranchName,
  WORKTREE_BRANCH_PREFIX,
} from "@t3tools/shared/git";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

type ThreadForkCommand = Extract<OrchestrationV2Command, { readonly type: "thread.fork" }>;

export class ThreadForkWorktreeError extends Schema.TaggedError<ThreadForkWorktreeError>()(
  "ThreadForkWorktreeError",
  {
    sourceThreadId: ThreadId,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface ThreadForkWorktreeResult {
  readonly dispatch: Orchestrator.OrchestratorV2DispatchResult;
  readonly worktreePath: string;
  readonly branch: string;
  /** checkpoint: the fork point's captured files; head: the source's HEAD, because no checkpoint exists. */
  readonly restoredFrom: "checkpoint" | "head";
}

/** Prepares a worktree at the fork point, then dispatches the fork bound to it. */
export class ThreadForkWorktree extends Context.Service<
  ThreadForkWorktree,
  {
    readonly fork: (
      command: ThreadForkCommand,
    ) => Effect.Effect<
      ThreadForkWorktreeResult,
      | ThreadForkWorktreeError
      | Orchestrator.OrchestratorV2Error
      | ThreadManagement.ThreadManagementProviderInstanceDisabledError
    >;
  }
>()("t3/orchestration-v2/ThreadForkWorktree") {}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const git = yield* GitWorkflow.GitWorkflowService;
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const setupScripts = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;

  const fork = Effect.fn("ThreadForkWorktree.fork")(function* (command: ThreadForkCommand) {
    const fail = (message: string) => (cause: unknown) =>
      new ThreadForkWorktreeError({ sourceThreadId: command.sourceThreadId, message, cause });

    if (command.sideChat === true) {
      return yield* fail("A side chat shares its parent's checkout.")(undefined);
    }
    const source = yield* threads.getThreadRecords(command.sourceThreadId, ["runs", "checkpoints"]);
    const sourceRun = Orchestrator.runForSourcePoint(source, command.sourcePoint);
    const projectId: ProjectId = source.thread.projectId;
    const project = yield* projects.getById(projectId).pipe(
      Effect.mapError(fail("Unable to read the project.")),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(fail("The fork's project was not found.")(undefined)),
          onSome: Effect.succeed,
        }),
      ),
    );
    const repoCwd = project.workspaceRoot;
    const { driver } = yield* vcsRegistry
      .resolve({ cwd: repoCwd, requestedKind: "git" })
      .pipe(Effect.mapError(fail("Forking into a worktree needs a git repository.")));
    const revParse = (cwd: string, revision: string) =>
      driver
        .execute({
          operation: "ThreadForkWorktree.revParse",
          cwd,
          args: ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`],
          allowNonZeroExit: true,
        })
        .pipe(
          Effect.map((result) => (result.exitCode === 0 ? result.stdout.trim() || null : null)),
          Effect.mapError(fail(`Unable to resolve ${revision}.`)),
        );

    // A checkpoint commit's parent is the HEAD it was captured on; its tree holds the files.
    const checkpoint = source.checkpoints.find(
      (candidate) => sourceRun !== null && candidate.id === sourceRun.checkpointId,
    );
    const checkpointCommit =
      checkpoint === undefined ? null : yield* revParse(repoCwd, checkpoint.ref);
    const checkpointParent =
      checkpointCommit === null ? null : yield* revParse(repoCwd, `${checkpointCommit}^`);
    const restoreRef = checkpointParent === null ? null : checkpoint!.ref;
    const startCommit =
      checkpointParent ?? (yield* revParse(source.thread.worktreePath ?? repoCwd, "HEAD"));
    if (startCommit === null) {
      return yield* fail("The source checkout has no commit to fork from.")(undefined);
    }

    const uuid = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
    let branch = buildTemporaryWorktreeBranchName(() => uuid.replaceAll("-", ""));
    // A branch named like the prefix blocks refs below it.
    if (
      yield* git
        .hasCommit({ cwd: repoCwd, refName: `refs/heads/${WORKTREE_BRANCH_PREFIX}` })
        .pipe(Effect.orElseSucceed(() => false))
    ) {
      branch = flattenTemporaryWorktreeBranchName(branch);
    }

    const worktree = yield* git
      .createWorktree({
        cwd: repoCwd,
        refName: startCommit,
        newRefName: branch,
        ...(source.thread.branch === null ? {} : { baseRefName: source.thread.branch }),
        path: null,
      })
      .pipe(Effect.mapError(fail("Unable to create the fork's worktree.")));
    const worktreePath = worktree.worktree.path;
    const removeWorktree = git
      .removeWorktree({ cwd: repoCwd, path: worktreePath, force: true })
      .pipe(
        Effect.andThen(
          git.deleteLocalBranch({ cwd: repoCwd, refName: worktree.worktree.refName, force: true }),
        ),
        Effect.ignoreCause({ log: true }),
      );

    const dispatch = yield* Effect.gen(function* () {
      if (restoreRef !== null) {
        yield* driver.checkpoints
          .restoreCheckpoint({ cwd: worktreePath, checkpointRef: restoreRef })
          .pipe(Effect.mapError(fail("Unable to restore the fork point's files.")));
      }
      return yield* threads.dispatch({
        ...command,
        workspace: {
          type: "existing_worktree",
          worktreePath,
          branch: worktree.worktree.refName,
        },
      });
    }).pipe(Effect.onError(() => removeWorktree));

    // Same setup as any new worktree thread; it runs in the fork's terminal and does not block.
    yield* setupScripts
      .runForThread({
        threadId: command.targetThreadId,
        projectId,
        projectCwd: repoCwd,
        worktreePath,
        project: { id: project.id, workspaceRoot: repoCwd, scripts: project.scripts },
      })
      .pipe(Effect.ignoreCause({ log: true }));

    const restoredFrom = restoreRef === null ? ("head" as const) : ("checkpoint" as const);
    yield* Effect.logInfo("Forked thread into a new worktree", {
      commandId: command.commandId,
      sourceThreadId: command.sourceThreadId,
      targetThreadId: command.targetThreadId,
      worktreePath,
      restoredFrom,
    });
    return { dispatch, worktreePath, branch: worktree.worktree.refName, restoredFrom };
  });

  return ThreadForkWorktree.of({ fork });
});

export const layer = Layer.effect(ThreadForkWorktree, make);
