// @effect-diagnostics nodeBuiltinImport:off - opt-in seed check reads SQLite files directly.
// Opt-in: POH_FOLD_SEED=<VACUUM INTO copy of a real statev2.sqlite> vp test run <this file>.
// Never point it at a live database; it only reads the seed to make two private copies.
// POH_FOLD_OUT=<dir> also keeps VACUUMed off/on copies there as A/B bench seeds.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionMaintenance from "./ProjectionMaintenance.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const seed = process.env.POH_FOLD_SEED;

// Every table `ProjectionMaintenance.rebuild` clears and refills.
const PROJECTION_TABLES = [
  "orchestration_v2_projection_threads",
  "orchestration_v2_projection_runs",
  "orchestration_v2_projection_run_attempts",
  "orchestration_v2_projection_nodes",
  "orchestration_v2_projection_subagents",
  "orchestration_v2_projection_provider_sessions",
  "orchestration_v2_projection_provider_session_bindings",
  "orchestration_v2_projection_provider_threads",
  "orchestration_v2_projection_provider_turns",
  "orchestration_v2_projection_runtime_requests",
  "orchestration_v2_projection_messages",
  "orchestration_v2_projection_plans",
  "orchestration_v2_projection_turn_items",
  "orchestration_v2_projection_checkpoint_scopes",
  "orchestration_v2_projection_checkpoints",
  "orchestration_v2_projection_context_handoffs",
  "orchestration_v2_projection_context_transfers",
  "orchestration_v2_turn_item_positions",
] as const;

/** Row count and a digest over every column of every row, in rowid (insertion) order. */
function digestProjections(file: string) {
  const db = new NodeSqlite.DatabaseSync(file, { readOnly: true });
  try {
    const out: Record<string, { rows: number; sha256: string }> = {};
    for (const table of PROJECTION_TABLES) {
      const hash = NodeCrypto.createHash("sha256");
      let rows = 0;
      for (const row of db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).iterate()) {
        hash.update(JSON.stringify(row));
        hash.update("\n");
        rows += 1;
      }
      out[table] = { rows, sha256: hash.digest("hex") };
    }
    return out;
  } finally {
    db.close();
  }
}

function eventStats(file: string) {
  const db = new NodeSqlite.DatabaseSync(file, { readOnly: true });
  try {
    return db
      .prepare(
        "SELECT COUNT(*) AS rows, COALESCE(SUM(length(payload_json)), 0) AS payloadBytes, MAX(sequence) AS head FROM orchestration_events",
      )
      .get() as { rows: number; payloadBytes: number; head: number };
  } finally {
    db.close();
  }
}

const maintain = (file: string, fold: boolean) =>
  Effect.gen(function* () {
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    const compacted = yield* maintenance.compactEventStore();
    const folded = fold
      ? yield* maintenance.foldSupersededSnapshots({
          settledBefore: DateTime.formatIso(yield* DateTime.now),
        })
      : null;
    const verification = yield* maintenance.rebuild;
    return { compacted, folded, verification };
  }).pipe(
    Effect.provide(
      ProjectionMaintenance.layer.pipe(
        Layer.provide(Layer.merge(EventStore.layer, ProjectionStore.layer)),
        Layer.provideMerge(SqlitePersistence.layerFromPath(file)),
      ),
    ),
    Effect.scoped,
  );

// Opt-in by design: it needs a real seed copy and minutes of CPU. Run it with
// `--testTimeout 3600000` because rebuilding a real seed exceeds the unit-test ceiling.
it.live.skipIf(seed === undefined)(
  "rebuilds the seed's projections identically with the snapshot fold on and off",
  () =>
    Effect.gen(function* () {
      const directory = NodeFS.mkdtempSync(
        NodePath.join(process.env.TMPDIR ?? NodeOS.tmpdir(), "poh-fold-seed-"),
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
      );
      const original = NodePath.join(directory, "original.sqlite");
      const off = NodePath.join(directory, "off.sqlite");
      const on = NodePath.join(directory, "on.sqlite");
      yield* Effect.sync(() => {
        const source = new NodeSqlite.DatabaseSync(seed!, { readOnly: true });
        for (const target of [original, off, on]) source.exec(`VACUUM INTO '${target}'`);
        source.close();
      });

      const resultOff = yield* maintain(off, false);
      const resultOn = yield* maintain(on, true);
      const digests = {
        original: digestProjections(original),
        off: digestProjections(off),
        on: digestProjections(on),
      };
      const report = {
        seed,
        off: { ...resultOff, events: eventStats(off) },
        on: { ...resultOn, events: eventStats(on) },
        tables: Object.fromEntries(
          PROJECTION_TABLES.map((table) => [
            table,
            {
              rows: digests.on[table]!.rows,
              onEqualsOff: digests.on[table]!.sha256 === digests.off[table]!.sha256,
              offEqualsLive: digests.off[table]!.sha256 === digests.original[table]!.sha256,
            },
          ]),
        ),
      };
      if (process.env.POH_FOLD_REPORT !== undefined) {
        NodeFS.writeFileSync(process.env.POH_FOLD_REPORT, JSON.stringify(report, null, 2));
      }
      yield* Effect.log(JSON.stringify(report));
      const keep = process.env.POH_FOLD_OUT;
      if (keep !== undefined) {
        NodeFS.mkdirSync(keep, { recursive: true });
        for (const [file, name] of [
          [off, "seed-off.sqlite"],
          [on, "seed-on.sqlite"],
        ] as const) {
          const target = NodePath.join(keep, name);
          for (const suffix of ["", "-wal", "-shm"])
            NodeFS.rmSync(target + suffix, { force: true });
          const db = new NodeSqlite.DatabaseSync(file, { readOnly: true });
          db.exec(`VACUUM INTO '${target}'`);
          db.close();
        }
      }
      assert.isTrue(resultOff.verification.valid);
      assert.isTrue(resultOn.verification.valid);
      assert.isAbove(resultOn.folded!.deletedEventCount, 0);
      assert.deepEqual(digests.on, digests.off);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
