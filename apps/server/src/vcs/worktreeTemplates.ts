// @effect-diagnostics nodeBuiltinImport:off - Git's index stores nanosecond ctime/mtime, dev, ino, uid and gid; only node:fs lstat reports them all.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";

import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import type { GitCommandError } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";

import type { CreateWorktreeProgress } from "./GitVcsDriver.ts";

/** Beside the worktrees of one repository, so templates and clones share a filesystem. */
const TEMPLATES_DIRECTORY = ".t3-templates";
const MANIFEST = ".t3-template.json";
const LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock", "bun.lockb"];
const KEPT_TEMPLATES = 2;
// One cp is bound by per-file create plus clone; four in parallel took the clone from ~14 s to ~4 s on t3code.
// Shared by every clone of this server, so launching many worktrees at once does not multiply the load.
const CLONE_CONCURRENCY = 4;
const CLONE_BATCH = 64;
const PNPM_WORKSPACE_STATE = ["node_modules", ".pnpm-workspace-state-v1.json"];

export interface WorktreeTemplate {
  readonly directory: string;
  /** The commit the template's tracked files are at. */
  readonly commit: string;
  /** The worktree the template's dependencies came from; pnpm's state file names it. */
  readonly source: string;
  readonly targetCommit: string;
}

class WorktreeTemplateError extends Data.TaggedError("WorktreeTemplateError")<{
  readonly detail: string;
}> {}

type Git = (
  operation: string,
  cwd: string,
  args: ReadonlyArray<string>,
  options?: { readonly env?: NodeJS.ProcessEnv; readonly timeoutMs?: number | null },
) => Effect.Effect<string, GitCommandError>;

const Manifest = Schema.fromJsonString(
  Schema.Struct({ commit: Schema.String, source: Schema.String }),
);
const decodeManifest = Schema.decodeUnknownEffect(Manifest);
const encodeManifest = Schema.encodeEffect(Manifest);
const encodeJsonString = Schema.encodeSync(Schema.fromJsonString(Schema.String));

/**
 * Copy-on-write templates for new worktrees, keyed by the lockfiles at the start commit. A worktree whose setup
 * succeeded is captured once (tracked files at its commit plus its node_modules); later worktrees with the same
 * lockfiles clone the template instead of checking out and installing from scratch. Every step fails without
 * side effects outside the template directory, so callers fall back to Git's checkout.
 */
export const makeWorktreeTemplates = Effect.fnUntraced(function* (git: Git) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const platform = yield* HostProcess.Platform;
  const cloneFlags = platform === "darwin" ? ["-c", "-a"] : ["-a", "--reflink=always"];
  const probes = new Map<string, boolean>();
  const clonePermits = yield* Semaphore.make(CLONE_CONCURRENCY);

  const templatesDirectory = (worktreePath: string) =>
    path.join(path.dirname(worktreePath), TEMPLATES_DIRECTORY);

  // `--reflink=always` and `-c` fail without copying data where the filesystem cannot clone.
  const cp = (sources: ReadonlyArray<string>, target: string) =>
    spawner
      .exitCode(
        ChildProcess.make("cp", [...cloneFlags, ...sources, target], {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        }),
      )
      .pipe(
        Effect.flatMap((code) =>
          code === 0
            ? Effect.void
            : Effect.fail(new WorktreeTemplateError({ detail: `cp exited with ${code}` })),
        ),
      );

  /** Clones one file once per directory and server run; false on Windows and on filesystems without clones. */
  const probe = Effect.fnUntraced(function* (directory: string) {
    const cached = probes.get(directory);
    if (cached !== undefined) return cached;
    const supported =
      (platform === "linux" || platform === "darwin") &&
      (yield* Effect.gen(function* () {
        yield* fs.makeDirectory(directory, { recursive: true });
        const scratch = yield* fs.makeTempDirectory({ directory, prefix: ".probe-" });
        const source = path.join(scratch, "probe");
        yield* fs.writeFileString(source, "t3");
        return yield* cp([source], `${source}-clone`).pipe(
          Effect.as(true),
          Effect.ensuring(fs.remove(scratch, { recursive: true }).pipe(Effect.ignore)),
        );
      }).pipe(Effect.orElseSucceed(() => false)));
    // Leave nothing behind where clones are unsupported.
    if (
      !supported &&
      (yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => [""]))).length === 0
    )
      yield* fs.remove(directory, { recursive: true }).pipe(Effect.ignore);
    probes.set(directory, supported);
    return supported;
  });

  const resolveCommit = (cwd: string, ref: string) =>
    git("WorktreeTemplates.resolveCommit", cwd, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${ref}^{commit}`,
    ]).pipe(Effect.map((stdout) => stdout.trim()));

  const templatePath = (cwd: string, commit: string, directory: string) =>
    git("WorktreeTemplates.lockfiles", cwd, ["ls-tree", commit, "--", ...LOCKFILES]).pipe(
      Effect.map((lockfiles) =>
        path.join(
          directory,
          NodeCrypto.createHash("sha256").update(lockfiles).digest("hex").slice(0, 16),
        ),
      ),
    );

  // pnpm's virtual store holds most files; its package directories make even work units for parallel cp.
  const expand = Effect.fnUntraced(function* (source: string, targetParent: string) {
    const pnpm = path.join(source, ".pnpm");
    if (path.basename(source) !== "node_modules" || !(yield* fs.exists(pnpm))) {
      return [[source, targetParent] as const];
    }
    const target = path.join(targetParent, "node_modules");
    yield* fs.makeDirectory(path.join(target, ".pnpm"), { recursive: true });
    return [
      ...(yield* fs.readDirectory(source))
        .filter((name) => name !== ".pnpm")
        .map((name) => [path.join(source, name), target] as const),
      ...(yield* fs.readDirectory(pnpm)).map(
        (name) => [path.join(pnpm, name), path.join(target, ".pnpm")] as const,
      ),
    ];
  });

  const cloneEntries = Effect.fnUntraced(function* (
    entries: ReadonlyArray<readonly [source: string, targetParent: string]>,
    onProgress?: CreateWorktreeProgress["onCheckoutProgress"],
  ) {
    const jobs = (yield* Effect.forEach(entries, ([source, target]) =>
      expand(source, target),
    )).flat();
    const batches = [...Map.groupBy(jobs, ([, target]) => target)].flatMap(([target, group]) =>
      Arr.chunksOf(
        group.map(([source]) => source),
        CLONE_BATCH,
      ).map((sources) => ({ target, sources })),
    );
    const completed = yield* Ref.make(0);
    yield* Effect.forEach(
      batches,
      ({ target, sources }) =>
        clonePermits
          .withPermits(1)(cp(sources, target))
          .pipe(
            Effect.andThen(Ref.updateAndGet(completed, (count) => count + 1)),
            Effect.flatMap((count) =>
              onProgress
                ? onProgress({
                    percent: Math.floor((count * 100) / batches.length),
                    completed: count,
                    total: batches.length,
                  })
                : Effect.void,
            ),
          ),
      { concurrency: CLONE_CONCURRENCY, discard: true },
    );
  });

  const find = Effect.fn("WorktreeTemplates.find")(
    function* (input: {
      readonly cwd: string;
      readonly refName: string;
      readonly worktreePath: string;
    }) {
      const directory = templatesDirectory(input.worktreePath);
      if (!(yield* probe(directory))) return null;
      const targetCommit = yield* resolveCommit(input.cwd, input.refName);
      const template = yield* templatePath(input.cwd, targetCommit, directory);
      const manifest = yield* fs
        .readFileString(path.join(template, MANIFEST))
        .pipe(Effect.flatMap(decodeManifest));
      return { directory: template, ...manifest, targetCommit } satisfies WorktreeTemplate;
    },
    Effect.orElseSucceed(() => null),
  );

  /** Fills a `--no-checkout` worktree from the template and leaves its index stat-clean. */
  const clone = Effect.fn("WorktreeTemplates.clone")(function* (
    template: WorktreeTemplate,
    worktreePath: string,
    onProgress?: CreateWorktreeProgress["onCheckoutProgress"],
  ) {
    const names = (yield* fs.readDirectory(template.directory)).filter((name) => name !== MANIFEST);
    yield* cloneEntries(
      names.map((name) => [path.join(template.directory, name), worktreePath] as const),
      onProgress,
    );
    const gitDir = (yield* git("WorktreeTemplates.gitDir", worktreePath, [
      "rev-parse",
      "--absolute-git-dir",
    ])).trim();
    yield* git("WorktreeTemplates.readTree", worktreePath, ["read-tree", template.commit]);
    yield* Effect.tryPromise({
      try: () => restatIndex(path.join(gitDir, "index"), worktreePath),
      catch: (cause) => new WorktreeTemplateError({ detail: String(cause) }),
    });
    if (template.commit !== template.targetCommit) {
      // Same lockfiles, newer commit: Git rewrites only the paths that differ.
      yield* git(
        "WorktreeTemplates.update",
        worktreePath,
        ["read-tree", "-m", "-u", template.commit, template.targetCommit],
        { timeoutMs: null },
      );
    }
    const state = path.join(worktreePath, ...PNPM_WORKSPACE_STATE);
    if (yield* fs.exists(state)) {
      const [from, to] = [template.source, worktreePath].map((root) =>
        encodeJsonString(root).slice(0, -1),
      );
      const contents = yield* fs.readFileString(state);
      yield* fs.writeFileString(
        state,
        contents.replaceAll(`${from}"`, `${to}"`).replaceAll(`${from}/`, `${to}/`),
      );
    }
  });

  /** Empties a worktree except its `.git` file, so a failed clone can fall back to a checkout. */
  const clear = (worktreePath: string) =>
    fs.readDirectory(worktreePath).pipe(
      Effect.flatMap((names) =>
        Effect.forEach(
          names.filter((name) => name !== ".git"),
          (name) => fs.remove(path.join(worktreePath, name), { recursive: true }),
          { discard: true },
        ),
      ),
      Effect.ignore,
    );

  /** Turning templates off removes them the next time this repository gets a worktree. */
  const removeAll = (worktreePath: string) =>
    fs.remove(templatesDirectory(worktreePath), { recursive: true }).pipe(Effect.ignore);

  /**
   * Captures `worktreePath` as the template for its lockfiles unless one exists. Tracked files come from its
   * commit, not its working tree, so an agent's edits never reach the template; dependencies are cloned as
   * they are.
   */
  const capture = Effect.fn("WorktreeTemplates.capture")(function* (worktreePath: string) {
    const directory = templatesDirectory(worktreePath);
    if (!(yield* probe(directory))) return;
    // Submodule checkouts point into this worktree's own Git directory.
    if (yield* fs.exists(path.join(worktreePath, ".gitmodules"))) return;
    const commit = yield* resolveCommit(worktreePath, "HEAD");
    const template = yield* templatePath(worktreePath, commit, directory);
    if (yield* fs.exists(template)) return;
    const dependencies = (yield* git("WorktreeTemplates.ignored", worktreePath, [
      "ls-files",
      "-z",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
    ]))
      .split("\0")
      .filter((entry) => entry === "node_modules/" || entry.endsWith("/node_modules/"));

    const staging = yield* fs.makeTempDirectory({ directory, prefix: ".staging-" });
    yield* Effect.gen(function* () {
      const env = { GIT_INDEX_FILE: `${staging}.index` };
      yield* git("WorktreeTemplates.stageIndex", worktreePath, ["read-tree", commit], { env });
      yield* git(
        "WorktreeTemplates.stageFiles",
        worktreePath,
        ["--work-tree", staging, "checkout-index", "--all", "--force"],
        { env, timeoutMs: null },
      );
      const entries = dependencies.map(
        (entry) =>
          [
            path.join(worktreePath, entry.slice(0, -1)),
            path.dirname(path.join(staging, entry.slice(0, -1))),
          ] as const,
      );
      yield* Effect.forEach(
        entries,
        ([, parent]) => fs.makeDirectory(parent, { recursive: true }),
        {
          discard: true,
        },
      );
      yield* cloneEntries(entries);
      yield* fs.writeFileString(
        path.join(staging, MANIFEST),
        yield* encodeManifest({ commit, source: worktreePath }),
      );
      yield* fs.rename(staging, template);
    }).pipe(
      Effect.ensuring(fs.remove(`${staging}.index`, { force: true }).pipe(Effect.ignore)),
      Effect.onError(() => fs.remove(staging, { recursive: true }).pipe(Effect.ignore)),
    );

    // Keep the newest templates by capture time. Staging leftovers of other captures go too.
    const names = yield* fs.readDirectory(directory);
    const captured = yield* Effect.forEach(
      names.filter((name) => !name.startsWith(".")),
      (name) =>
        fs.stat(path.join(directory, name, MANIFEST)).pipe(
          Effect.map((info) => ({
            name,
            time: Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() }),
          })),
          Effect.orElseSucceed(() => ({ name, time: 0 })),
        ),
    );
    const evicted = [
      ...names.filter((name) => name.startsWith(".staging-")),
      ...captured
        .toSorted((a, b) => b.time - a.time)
        .slice(KEPT_TEMPLATES)
        .map(({ name }) => name),
    ];
    yield* Effect.forEach(
      evicted,
      (name) => fs.remove(path.join(directory, name), { recursive: true }).pipe(Effect.ignore),
      { discard: true },
    );
  });

  return { find, clone, clear, removeAll, capture };
});

/** Rewrites each entry's stat data in the SHA-1 index v2/v3 at `indexPath` from the files under `root`. */
const restatIndex = async (indexPath: string, root: string) => {
  const index = await NodeFSP.readFile(indexPath);
  const body = index.subarray(0, -20);
  const version = body.readUInt32BE(4);
  const digest = NodeCrypto.createHash("sha1").update(body).digest();
  if (!digest.equals(index.subarray(-20)) || (version !== 2 && version !== 3)) {
    throw new Error("unsupported index format");
  }
  const parts = [Buffer.from(body.subarray(0, 12))];
  let offset = 12;
  for (let count = body.readUInt32BE(8); count > 0; count--) {
    const flags = body.readUInt16BE(offset + 60);
    const header = 62 + (version === 3 && flags & 0x4000 ? 2 : 0);
    const nameEnd = body.indexOf(0, offset + header);
    const next = offset + (Math.floor((nameEnd - offset) / 8) + 1) * 8;
    const entry = Buffer.from(body.subarray(offset, next));
    // Gitlinks carry no stat data.
    if ((entry.readUInt32BE(24) & 0o170000) !== 0o160000) {
      const name = body.subarray(offset + header, nameEnd).toString("utf8");
      const stat = await NodeFSP.lstat(`${root}/${name}`, { bigint: true });
      const times = [stat.ctimeNs, stat.mtimeNs].flatMap((ns) => [
        ns / 1_000_000_000n,
        ns % 1_000_000_000n,
      ]);
      const fields: Array<readonly [number, bigint]> = [
        ...times.map((value, at) => [at * 4, value] as const),
        [16, stat.dev],
        [20, stat.ino],
        [28, stat.uid],
        [32, stat.gid],
        [36, stat.size],
      ];
      for (const [at, value] of fields) entry.writeUInt32BE(Number(value & 0xffffffffn), at);
    }
    parts.push(entry);
    offset = next;
  }
  // Keep the cache tree; other optional extensions hold stat data or offsets that no longer apply.
  while (offset < body.length) {
    const size = 8 + body.readUInt32BE(offset + 4);
    const signature = body.subarray(offset, offset + 4).toString("latin1");
    if (!/^[A-Z]/.test(signature)) throw new Error(`index extension ${signature} is required`);
    if (signature === "TREE") parts.push(Buffer.from(body.subarray(offset, offset + size)));
    offset += size;
  }
  const out = Buffer.concat(parts);
  await NodeFSP.writeFile(
    indexPath,
    Buffer.concat([out, NodeCrypto.createHash("sha1").update(out).digest()]),
  );
};
