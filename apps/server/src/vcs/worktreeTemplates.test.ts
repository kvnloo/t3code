// @effect-diagnostics nodeBuiltinImport:off - realpath and readlink check that cloned symlinks stay inside the clone.
import * as NodeFS from "node:fs";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../config.ts";
import { makeGitVcsDriverCore } from "./GitVcsDriverCore.ts";

const layerTest = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-worktree-templates-test-",
}).pipe(Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

type CopyMode = "plain" | "unsupported" | "fail-clone";

/**
 * Records Git arguments and stands in for the filesystem: "plain" drops the clone flags so the tests run on any
 * filesystem, "unsupported" fails every clone like ext4 does, "fail-clone" fails only clones out of a template.
 */
const makeDriver = Effect.fnUntraced(function* (mode: { current: CopyMode }) {
  const delegate = yield* ChildProcessSpawner.ChildProcessSpawner;
  const gitArgs: Array<ReadonlyArray<string>> = [];
  const spawner = ChildProcessSpawner.make((command) => {
    if (!ChildProcess.isStandardCommand(command) || command.command !== "cp") {
      if (ChildProcess.isStandardCommand(command)) gitArgs.push(command.args.map(String));
      return delegate.spawn(command);
    }
    const args = command.args.map(String);
    const failing =
      mode.current === "unsupported" ||
      (mode.current === "fail-clone" && args.some((arg) => arg.includes("/.t3-templates/")));
    const copy = failing
      ? ChildProcess.make("false", [], command.options)
      : ChildProcess.make(
          "cp",
          args.filter((arg) => arg !== "--reflink=always" && arg !== "-c"),
          command.options,
        );
    return delegate.spawn(copy);
  });
  const driver = yield* makeGitVcsDriverCore().pipe(
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
  );
  const git = (cwd: string, args: ReadonlyArray<string>) =>
    driver
      .execute({ operation: "worktreeTemplates.test", cwd, args, timeoutMs: 10_000 })
      .pipe(Effect.map((result) => result.stdout.trim()));
  return { driver, git, gitArgs };
});

const setup = Effect.fnUntraced(function* (mode: CopyMode = "plain") {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const copyMode = { current: mode };
  const { driver, git, gitArgs } = yield* makeDriver(copyMode);
  const root = NodeFS.realpathSync(yield* fs.makeTempDirectoryScoped({ prefix: "t3-templates-" }));
  const repo = path.join(root, "repo");
  yield* fs.makeDirectory(repo);
  yield* driver.initRepo({ cwd: repo });
  yield* git(repo, ["config", "user.email", "test@test.com"]);
  yield* git(repo, ["config", "user.name", "Test"]);
  yield* fs.makeDirectory(path.join(repo, "src"));
  yield* fs.writeFileString(path.join(repo, "src/index.ts"), "export const one = 1;\n");
  yield* fs.writeFileString(path.join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  yield* fs.writeFileString(path.join(repo, ".gitignore"), "node_modules/\n");
  yield* git(repo, ["add", "."]);
  yield* git(repo, ["commit", "-m", "initial"]);
  const branch = yield* git(repo, ["branch", "--show-current"]);
  const worktrees = path.join(root, "worktrees");
  const templates = path.join(worktrees, ".t3-templates");

  const commit = Effect.fnUntraced(function* (file: string, contents: string) {
    yield* fs.writeFileString(path.join(repo, file), contents);
    yield* git(repo, ["commit", "-qam", `edit ${file}`]);
  });
  const create = (name: string, worktreeTemplates = true) =>
    driver.createWorktree(
      { cwd: repo, refName: branch, newRefName: `t3/${name}`, path: path.join(worktrees, name) },
      { worktreeTemplates },
    );
  /** What a successful `pnpm install` leaves behind, including links and pnpm's absolute state path. */
  const install = Effect.fnUntraced(function* (worktree: string) {
    const pkg = path.join(worktree, "node_modules/.pnpm/dep@1.0.0/node_modules/dep");
    yield* fs.makeDirectory(pkg, { recursive: true });
    yield* fs.writeFileString(path.join(pkg, "index.js"), "module.exports = 1;\n");
    NodeFS.symlinkSync(".pnpm/dep@1.0.0/node_modules/dep", path.join(worktree, "node_modules/dep"));
    yield* fs.writeFileString(
      path.join(worktree, "node_modules/.pnpm-workspace-state-v1.json"),
      JSON.stringify({ projects: { [worktree]: {} }, dir: `${worktree}/node_modules` }),
    );
  });
  const listTemplates = fs
    .readDirectory(templates)
    .pipe(Effect.map((names) => names.filter((name) => !name.startsWith("."))));

  return {
    fs,
    path,
    driver,
    git,
    gitArgs,
    copyMode,
    worktrees,
    templates,
    commit,
    create,
    install,
    listTemplates,
  };
});

it.effect("clones a captured template with dependencies and a stat-clean index", () =>
  Effect.gen(function* () {
    const { fs, path, driver, git, gitArgs, create, install, listTemplates } = yield* setup();
    const first = yield* create("first");
    yield* install(first.worktree.path);
    yield* driver.captureWorktreeTemplate(first.worktree.path);
    assert.equal((yield* listTemplates).length, 1);

    gitArgs.length = 0;
    const second = (yield* create("second")).worktree.path;

    assert.isTrue(
      gitArgs.some((args) => args.includes("worktree") && args.includes("--no-checkout")),
    );
    // diff-files compares stat data only: an entry whose stat differs from the index is listed.
    assert.equal(yield* git(second, ["diff-files", "--name-only"]), "");
    assert.equal(yield* git(second, ["status", "--porcelain"]), "");
    assert.equal(yield* git(second, ["branch", "--show-current"]), "t3/second");
    const dep = path.join(second, "node_modules/dep");
    assert.equal(NodeFS.readlinkSync(dep), ".pnpm/dep@1.0.0/node_modules/dep");
    assert.isTrue(NodeFS.realpathSync(dep).startsWith(`${second}/`));
    const state = yield* fs.readFileString(
      path.join(second, "node_modules/.pnpm-workspace-state-v1.json"),
    );
    assert.deepStrictEqual(JSON.parse(state), {
      projects: { [second]: {} },
      dir: `${second}/node_modules`,
    });
    assert.isFalse(state.includes(first.worktree.path));
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("checks out normally and keeps no templates where the filesystem cannot clone", () =>
  Effect.gen(function* () {
    const { fs, path, driver, git, gitArgs, templates, create, install } =
      yield* setup("unsupported");
    const first = yield* create("first");
    yield* install(first.worktree.path);
    yield* driver.captureWorktreeTemplate(first.worktree.path);
    assert.isFalse(yield* fs.exists(templates));

    gitArgs.length = 0;
    const second = (yield* create("second")).worktree.path;
    assert.isFalse(gitArgs.some((args) => args.includes("--no-checkout")));
    assert.equal(yield* git(second, ["status", "--porcelain"]), "");
    assert.isFalse(yield* fs.exists(path.join(second, "node_modules")));
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("reuses a template for a newer commit and rebuilds when the lockfile changes", () =>
  Effect.gen(function* () {
    const { fs, path, driver, git, gitArgs, commit, create, install, listTemplates } =
      yield* setup();
    const first = yield* create("first");
    yield* install(first.worktree.path);
    yield* driver.captureWorktreeTemplate(first.worktree.path);
    const [oldest] = yield* listTemplates;

    // Same lockfile, newer source: the template is cloned and Git updates only what changed.
    yield* commit("src/index.ts", "export const one = 2;\n");
    gitArgs.length = 0;
    const newer = (yield* create("newer")).worktree.path;
    assert.isTrue(gitArgs.some((args) => args.includes("--no-checkout")));
    assert.equal(
      yield* fs.readFileString(path.join(newer, "src/index.ts")),
      "export const one = 2;\n",
    );
    assert.equal(yield* git(newer, ["status", "--porcelain"]), "");
    assert.isTrue(yield* fs.exists(path.join(newer, "node_modules/dep")));

    // A new lockfile has no template: plain checkout, then its own template after setup.
    yield* commit("pnpm-lock.yaml", "lockfileVersion: '9.0'\npackages: {}\n");
    gitArgs.length = 0;
    const relocked = (yield* create("relocked")).worktree.path;
    assert.isFalse(gitArgs.some((args) => args.includes("--no-checkout")));
    assert.isFalse(yield* fs.exists(path.join(relocked, "node_modules")));
    yield* install(relocked);
    yield* driver.captureWorktreeTemplate(relocked);
    assert.equal((yield* listTemplates).length, 2);

    // A third lockfile evicts the oldest template.
    yield* commit("pnpm-lock.yaml", "lockfileVersion: '9.0'\npackages: { a: {} }\n");
    const third = (yield* create("third")).worktree.path;
    yield* install(third);
    yield* driver.captureWorktreeTemplate(third);
    const remaining = yield* listTemplates;
    assert.equal(remaining.length, 2);
    assert.notInclude(remaining, oldest);
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("falls back to a checkout when cloning the template fails", () =>
  Effect.gen(function* () {
    const { fs, path, driver, git, copyMode, create, install } = yield* setup();
    const first = yield* create("first");
    yield* install(first.worktree.path);
    yield* driver.captureWorktreeTemplate(first.worktree.path);

    copyMode.current = "fail-clone";
    const second = (yield* create("second")).worktree.path;
    assert.equal(yield* git(second, ["status", "--porcelain"]), "");
    assert.equal(
      yield* fs.readFileString(path.join(second, "src/index.ts")),
      "export const one = 1;\n",
    );
    assert.isFalse(yield* fs.exists(path.join(second, "node_modules")));
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("removes a cloned worktree, and turning templates off removes the templates", () =>
  Effect.gen(function* () {
    const { fs, driver, git, templates, create, install, worktrees } = yield* setup();
    const first = yield* create("first");
    yield* install(first.worktree.path);
    yield* driver.captureWorktreeTemplate(first.worktree.path);
    const second = (yield* create("second")).worktree.path;

    yield* driver.removeWorktree({ cwd: first.worktree.path, path: second, force: true });
    assert.isFalse(yield* fs.exists(second));
    assert.notInclude(yield* git(first.worktree.path, ["worktree", "list"]), second);
    assert.isTrue(yield* fs.exists(templates));

    yield* create("stock", false);
    assert.isFalse(yield* fs.exists(templates));
    assert.isTrue((yield* fs.readDirectory(worktrees)).includes("stock"));
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);
