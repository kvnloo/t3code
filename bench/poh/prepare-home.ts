// Builds a disposable bench home from the worktree's seeded DB (itself a VACUUM INTO copy of the
// live DB). The live install is never opened here.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

export function prepareHome(options: { readonly seed: string; readonly t3Home: string }) {
  const resolvedSeed = NodeFS.realpathSync(options.seed);
  if (resolvedSeed.startsWith(NodePath.join(process.env.HOME ?? "/nonexistent", ".t3") + "/")) {
    throw new Error(`refusing to use the live T3 home as a seed: ${resolvedSeed}`);
  }
  const userdata = NodePath.join(options.t3Home, "userdata");
  NodeFS.mkdirSync(userdata, { recursive: true });
  const db = NodePath.join(userdata, "statev2.sqlite");
  for (const suffix of ["", "-wal", "-shm"]) NodeFS.rmSync(db + suffix, { force: true });
  NodeFS.copyFileSync(resolvedSeed, db);
  const sql = new NodeSqlite.DatabaseSync(db);
  // A copied scheduled task would launch a real provider turn from the bench server.
  const disabled = sql.prepare("UPDATE scheduled_tasks SET enabled = 0 WHERE enabled != 0").run();
  sql.close();
  return { db, disabledScheduledTasks: Number(disabled.changes) };
}
