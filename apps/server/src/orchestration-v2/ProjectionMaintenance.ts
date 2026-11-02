import { ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import {
  SNAPSHOT_FOLD_METADATA_NAME,
  snapshotFoldThreadMetadataName,
} from "../persistence/OrchestrationEventStore.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

export interface ProjectionVerificationV2 {
  readonly valid: boolean;
  readonly schemaVersion: number;
  readonly expectedSequence: number;
  readonly projectionSequence: number;
  readonly unreadableThreadIds: ReadonlyArray<ThreadId>;
  readonly missingThreadIds: ReadonlyArray<ThreadId>;
  readonly unexpectedThreadIds: ReadonlyArray<ThreadId>;
}

export class ProjectionMaintenanceError extends Schema.TaggedError<ProjectionMaintenanceError>()(
  "ProjectionMaintenanceError",
  {
    operation: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface ProjectionMaintenanceV2Shape {
  readonly verify: Effect.Effect<ProjectionVerificationV2, ProjectionMaintenanceError>;
  readonly rebuild: Effect.Effect<ProjectionVerificationV2, ProjectionMaintenanceError>;
  readonly compactEventStore: (betweenPages?: Effect.Effect<void>) => Effect.Effect<
    {
      readonly deletedEventCount: number;
      readonly deletedReceiptCount: number;
      readonly reclaimableBytes: number;
    },
    ProjectionMaintenanceError
  >;
  /** Opt-in (`T3CODE_EXPERIMENTAL_SNAPSHOT_FOLD`): keep one row per settled snapshot entity. */
  readonly foldSupersededSnapshots: (options: {
    readonly settledThrough: number;
    readonly betweenPages?: Effect.Effect<void>;
  }) => Effect.Effect<
    {
      readonly foldedEntityCount: number;
      readonly deletedEventCount: number;
      readonly transactionCount: number;
      readonly longestTransactionMillis: number;
    },
    ProjectionMaintenanceError
  >;
}

/**
 * Whole-entity snapshot events keyed by `$.id`, folded by `foldSupersededSnapshots`. Each must
 * project only onto its own entity, so applying the final body at the first row is order-neutral.
 * `provider-thread.updated` is excluded: it also sets `thread.activeProviderThreadId`, so the
 * relative order of provider threads (and of thread.* events) decides the projection.
 */
const FOLDABLE_SNAPSHOT_EVENT_TYPES = [
  "message.updated",
  "node.updated",
  "turn-item.updated",
] as const;

/** Events whose replay keeps the previous `projection.updatedAt` (client and server apply). */
const NON_ACTIVITY_EVENT_TYPES = ["thread.visited", "thread.tags-updated", "thread.marked-unread"];

// Entities per fold transaction; bounds how long one chunk holds the SQLite writer.
const FOLD_ENTITIES_PER_TRANSACTION = 64;

export class ProjectionMaintenanceV2 extends Context.Service<
  ProjectionMaintenanceV2,
  ProjectionMaintenanceV2Shape
>()("t3/orchestration-v2/ProjectionMaintenance/ProjectionMaintenanceV2") {}

type ProjectionMetadataRow = {
  readonly schema_version: number;
  readonly last_sequence: number;
};

const encodeEntityKey = Schema.encodeSync(
  Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String, Schema.NullOr(Schema.String)])),
);

export const layer: Layer.Layer<
  ProjectionMaintenanceV2,
  never,
  EventStore.EventStoreV2 | ProjectionStore.ProjectionStoreV2 | SqlClient.SqlClient
> = Layer.effect(
  ProjectionMaintenanceV2,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const eventStore = yield* EventStore.EventStoreV2;
    const projectionStore = yield* ProjectionStore.ProjectionStoreV2;

    const verify = Effect.gen(function* () {
      const expectedThreadRows = yield* sql<{ readonly thread_id: string }>`
        SELECT DISTINCT stream_id AS thread_id
        FROM orchestration_events INDEXED BY orchestration_events_v2_created_threads_idx
        WHERE application_event_version = 2
          AND aggregate_kind = 'thread'
          AND event_type = 'thread.created'
        ORDER BY stream_id ASC
      `;
      const projectionRows = yield* sql<{ readonly thread_id: string }>`
        SELECT thread_id
        FROM orchestration_v2_projection_threads
        ORDER BY thread_id ASC
      `;
      const actualIds = projectionRows.map((row) => ThreadId.make(row.thread_id));
      const expectedIds = expectedThreadRows.map((row) => ThreadId.make(row.thread_id));
      const actualSet = new Set(actualIds);
      const expectedSet = new Set(expectedIds);
      const missingThreadIds = expectedIds.filter((threadId) => !actualSet.has(threadId));
      const unexpectedThreadIds = actualIds.filter((threadId) => !expectedSet.has(threadId));
      const unreadableThreadIds = yield* projectionStore.getUnreadableThreadIds();
      const metadata = yield* sql<ProjectionMetadataRow>`
        SELECT schema_version, last_sequence
        FROM orchestration_v2_projection_metadata
        WHERE projection_name = 'thread-projections'
        LIMIT 1
      `;
      const expectedSequence = yield* eventStore.latestSequence();
      const schemaVersion = metadata[0]?.schema_version ?? 0;
      const projectionSequence = metadata[0]?.last_sequence ?? 0;
      return {
        valid:
          schemaVersion === ProjectionStore.ORCHESTRATION_V2_PROJECTION_SCHEMA_VERSION &&
          projectionSequence === expectedSequence &&
          missingThreadIds.length === 0 &&
          unexpectedThreadIds.length === 0 &&
          unreadableThreadIds.length === 0,
        schemaVersion,
        expectedSequence,
        projectionSequence,
        unreadableThreadIds,
        missingThreadIds,
        unexpectedThreadIds,
      } satisfies ProjectionVerificationV2;
    }).pipe(sql.withTransaction);

    const rebuild = Effect.gen(function* () {
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const throughSequence = yield* eventStore.latestSequence();
          yield* sql`DELETE FROM orchestration_v2_projection_context_transfers`;
          yield* sql`DELETE FROM orchestration_v2_projection_context_handoffs`;
          yield* sql`DELETE FROM orchestration_v2_projection_checkpoints`;
          yield* sql`DELETE FROM orchestration_v2_projection_checkpoint_scopes`;
          yield* sql`DELETE FROM orchestration_v2_projection_turn_items`;
          yield* sql`DELETE FROM orchestration_v2_projection_plans`;
          yield* sql`DELETE FROM orchestration_v2_projection_messages`;
          yield* sql`DELETE FROM orchestration_v2_projection_runtime_requests`;
          yield* sql`DELETE FROM orchestration_v2_projection_provider_turns`;
          yield* sql`DELETE FROM orchestration_v2_projection_provider_threads`;
          yield* sql`DELETE FROM orchestration_v2_projection_provider_session_bindings`;
          yield* sql`DELETE FROM orchestration_v2_projection_provider_sessions`;
          yield* sql`DELETE FROM orchestration_v2_projection_subagents`;
          yield* sql`DELETE FROM orchestration_v2_projection_nodes`;
          yield* sql`DELETE FROM orchestration_v2_projection_run_attempts`;
          yield* sql`DELETE FROM orchestration_v2_projection_runs`;
          yield* sql`DELETE FROM orchestration_v2_projection_threads`;
          yield* sql`DELETE FROM orchestration_v2_turn_item_positions`;

          const pageSize = 500;
          let lastSequence = 0;
          while (true) {
            const page = yield* eventStore
              .read({ afterSequence: lastSequence, throughSequence, limit: pageSize })
              .pipe(Stream.runCollect);
            for (const stored of page) {
              yield* projectionStore.apply(stored.event);
              if (stored.event.type === "turn-item.updated") {
                yield* sql`
                INSERT INTO orchestration_v2_turn_item_positions (
                  thread_id,
                  turn_item_id,
                  ordinal
                )
                VALUES (
                  ${stored.event.threadId},
                  ${stored.event.payload.id},
                  ${stored.event.payload.ordinal}
                )
                ON CONFLICT(thread_id, turn_item_id) DO UPDATE SET
                  ordinal = excluded.ordinal
                `;
              }
              lastSequence = stored.sequence;
            }
            if (page.length < pageSize) break;
            yield* Effect.yieldNow;
          }
          const now = DateTime.formatIso(yield* DateTime.now);
          yield* sql`
            INSERT INTO orchestration_v2_projection_metadata (
              projection_name,
              schema_version,
              last_sequence,
              updated_at
            )
            VALUES (
              'thread-projections',
              ${ProjectionStore.ORCHESTRATION_V2_PROJECTION_SCHEMA_VERSION},
              ${lastSequence},
              ${now}
            )
            ON CONFLICT(projection_name) DO UPDATE SET
              schema_version = excluded.schema_version,
              last_sequence = excluded.last_sequence,
              updated_at = excluded.updated_at
          `;
        }),
      );
      return yield* verify;
    });

    const mapError =
      (operation: string) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.mapError((cause) => new ProjectionMaintenanceError({ operation, cause })),
        );

    // Keep thread.created as the verification and replay anchor; clients recognize deletion by thread.deleted event type.
    const SUPERSEDABLE_THREAD_EVENT_TYPES = [
      "thread.archived",
      "thread.unarchived",
      "thread.settled",
      "thread.unsettled",
      "thread.snoozed",
      "thread.unsnoozed",
      "thread.pinned",
      "thread.auto-settle-set",
      "thread.unpinned",
      "thread.pin-reordered",
      "thread.active-reordered",
      "thread.metadata-updated",
      "thread.pull-request-synced",
      "thread.runtime-mode-updated",
      "thread.interaction-mode-updated",
      "thread.model-selection-updated",
      "thread.provider-switched",
      "thread.guest-share-updated",
    ];
    // Read-state events preserve updatedAt and supersede only each other. Activity events supersede both groups.
    const READ_STATE_THREAD_EVENT_TYPES = ["thread.visited", "thread.marked-unread"];
    // Older clients skip tag events, so these supersede only each other.
    const TAG_THREAD_EVENT_TYPE = "thread.tags-updated";

    const supersedableThreadEventTypes = new Set(SUPERSEDABLE_THREAD_EVENT_TYPES);
    const readStateThreadEventTypes = new Set(READ_STATE_THREAD_EVENT_TYPES);
    // Subagent snapshots stay intact because later rows can reference an earlier prompt.
    // Commanded turn items stay for command-result replay.
    // Small pages bound work on the reader worker and synchronous fallback.
    const COMPACTION_PAGE_SIZE = 50;

    // Keep first/latest keyed events for replay order; page every event to bound sparse scans.
    const compactEventStore = Effect.fn("ProjectionMaintenance.compactEventStore")(function* (
      betweenPages: Effect.Effect<void> = Effect.void,
    ) {
      const bounds = yield* sql<{
        readonly event_sequence: number;
        readonly receipt_row_id: number;
      }>`
        SELECT
          COALESCE((SELECT MAX(sequence) FROM orchestration_events), 0) AS event_sequence,
          COALESCE((SELECT MAX(rowid) FROM orchestration_command_receipts), 0) AS receipt_row_id
      `.pipe(NodeSqliteClient.readOnly);
      let throughSequence = bounds[0]?.event_sequence ?? 0;
      let throughReceiptRowId = bounds[0]?.receipt_row_id ?? 0;
      const retainedThreadIds = new Set<string>();
      const retainedReadStateThreadIds = new Set<string>();
      const retainedTagThreadIds = new Set<string>();
      // Retain each key's oldest candidate, deleting it only when an older event appears.
      const oldestCandidateByEntityKey = new Map<string, number | null>();
      let deletedEventCount = 0;
      let deletedReceiptCount = 0;

      while (throughSequence > 0) {
        const rows = yield* sql<{
          readonly sequence: number;
          readonly application_event_version: number;
          readonly aggregate_kind: string;
          readonly stream_id: string;
          readonly event_type: string;
          readonly entity_id: string | null;
          readonly imported_legacy_thread: number;
        }>`
          SELECT
            event.sequence,
            event.application_event_version,
            event.aggregate_kind,
            event.stream_id,
            event.event_type,
            CASE
              WHEN event.application_event_version = 2
                AND event.event_type IN ('message.updated', 'node.updated')
              THEN json_extract(event.payload_json, '$.id')
              WHEN event.application_event_version = 2
                AND event.event_type = 'turn-item.updated'
                AND event.command_id IS NULL
                AND json_extract(event.payload_json, '$.type') <> 'subagent'
              THEN json_extract(event.payload_json, '$.id')
              WHEN event.application_event_version = 2
                AND event.event_type = 'thread.pull-request-link-updated'
              THEN json_array(json_extract(event.payload_json, '$.host'),
                json_extract(event.payload_json, '$.repository'),
                json_extract(event.payload_json, '$.number'))
              ELSE NULL
            END AS entity_id,
            CASE
              WHEN event.application_event_version = 1 AND event.aggregate_kind = 'thread'
              THEN EXISTS (
                SELECT 1 FROM orchestration_v2_legacy_imports AS legacy_import
                WHERE legacy_import.thread_id = event.stream_id
                  AND legacy_import.transcript_imported_at IS NOT NULL
              )
              ELSE 0
            END AS imported_legacy_thread
          FROM orchestration_events AS event
          WHERE event.sequence <= ${throughSequence}
          ORDER BY event.sequence DESC
          LIMIT ${COMPACTION_PAGE_SIZE + 1}
        `.pipe(NodeSqliteClient.readOnly);
        const page = rows.slice(0, COMPACTION_PAGE_SIZE);
        const obsolete: number[] = [];
        for (const row of page) {
          if (row.imported_legacy_thread === 1) {
            obsolete.push(row.sequence);
          } else if (row.application_event_version === 2) {
            if (
              row.aggregate_kind === "thread" &&
              supersedableThreadEventTypes.has(row.event_type)
            ) {
              if (retainedThreadIds.has(row.stream_id)) obsolete.push(row.sequence);
              else retainedThreadIds.add(row.stream_id);
            } else if (
              row.aggregate_kind === "thread" &&
              readStateThreadEventTypes.has(row.event_type)
            ) {
              if (
                retainedThreadIds.has(row.stream_id) ||
                retainedReadStateThreadIds.has(row.stream_id)
              ) {
                obsolete.push(row.sequence);
              } else retainedReadStateThreadIds.add(row.stream_id);
            } else if (
              row.aggregate_kind === "thread" &&
              row.event_type === TAG_THREAD_EVENT_TYPE
            ) {
              if (retainedThreadIds.has(row.stream_id) || retainedTagThreadIds.has(row.stream_id)) {
                obsolete.push(row.sequence);
              } else retainedTagThreadIds.add(row.stream_id);
            } else if (
              row.event_type === "thread.pull-request-link-updated" &&
              retainedThreadIds.has(row.stream_id)
            ) {
              // A newer whole-thread payload already carries this link's state.
              obsolete.push(row.sequence);
            } else if (
              row.event_type === "thread.pull-request-link-updated" ||
              row.event_type === "message.updated" ||
              row.event_type === "node.updated" ||
              (row.event_type === "turn-item.updated" && row.entity_id !== null)
            ) {
              const key = encodeEntityKey([row.event_type, row.stream_id, row.entity_id]);
              const candidate = oldestCandidateByEntityKey.get(key);
              if (candidate === undefined) oldestCandidateByEntityKey.set(key, null);
              else {
                if (candidate !== null) obsolete.push(candidate);
                oldestCandidateByEntityKey.set(key, row.sequence);
              }
            }
          }
        }
        // Never hold a transaction or the reader lock across a yield or a rest.
        yield* Effect.yieldNow;
        if (obsolete.length > 0) {
          yield* sql`DELETE FROM orchestration_events WHERE sequence IN ${sql.in(obsolete)}`;
          deletedEventCount += obsolete.length;
          yield* Effect.yieldNow;
        }
        throughSequence =
          rows.length <= COMPACTION_PAGE_SIZE ? 0 : (page.at(-1)?.sequence ?? 1) - 1;
        if (throughSequence > 0 || throughReceiptRowId > 0) yield* betweenPages;
      }

      while (throughReceiptRowId > 0) {
        const rows = yield* sql<{
          readonly row_id: number;
          readonly command_id: string;
          readonly imported_legacy_thread: number;
        }>`
          SELECT
            receipt.rowid AS row_id,
            receipt.command_id,
            CASE
              WHEN receipt.command_type = 'legacy' AND receipt.aggregate_kind = 'thread'
              THEN EXISTS (
                SELECT 1 FROM orchestration_v2_legacy_imports AS legacy_import
                WHERE legacy_import.thread_id = receipt.aggregate_id
                  AND legacy_import.transcript_imported_at IS NOT NULL
              )
              ELSE 0
            END AS imported_legacy_thread
          FROM orchestration_command_receipts AS receipt
          WHERE receipt.rowid <= ${throughReceiptRowId}
          ORDER BY receipt.rowid DESC
          LIMIT ${COMPACTION_PAGE_SIZE + 1}
        `.pipe(NodeSqliteClient.readOnly);
        const page = rows.slice(0, COMPACTION_PAGE_SIZE);
        const obsolete = page
          .filter((row) => row.imported_legacy_thread === 1)
          .map((row) => row.command_id);
        yield* Effect.yieldNow;
        if (obsolete.length > 0) {
          yield* sql`DELETE FROM orchestration_command_receipts WHERE command_id IN ${sql.in(obsolete)}`;
          deletedReceiptCount += obsolete.length;
          yield* Effect.yieldNow;
        }
        throughReceiptRowId = (page.at(-1)?.row_id ?? 1) - 1;
        if (rows.length <= COMPACTION_PAGE_SIZE) break;
        yield* betweenPages;
      }

      const freelistRows = yield* sql<{ readonly freelist_count: number }>`PRAGMA freelist_count`;
      const pageSizeRows = yield* sql<{ readonly page_size: number }>`PRAGMA page_size`;
      const reclaimableBytes =
        (freelistRows[0]?.freelist_count ?? 0) * (pageSizeRows[0]?.page_size ?? 0);

      return { deletedEventCount, deletedReceiptCount, reclaimableBytes };
    }, mapError("compact event store"));

    // Moves each entity's newest body into its oldest row and deletes the rows between, raising
    // the thread's watermark so resume from inside a folded range takes a snapshot. Only the
    // payload moves: the row keeps its envelope (event_id, occurred_at, metadata_json), so
    // occurred_at stays monotonic. See docs/internals/snapshot-fold.md.
    const foldSupersededSnapshots = Effect.fn("ProjectionMaintenance.foldSupersededSnapshots")(
      function* (options: {
        // Entities with a row above this sequence are left for a later pass. The caller samples
        // the head and waits out the settle age on a monotonic clock, so fresh cursors
        // (snapshot-then-live catch-up, task waits) never fall inside a fold.
        readonly settledThrough: number;
        readonly betweenPages?: Effect.Effect<void>;
      }) {
        const betweenPages = options.betweenPages ?? Effect.void;
        const streams = yield* sql<{
          readonly stream_id: string;
          readonly newest_activity: number | null;
        }>`
          SELECT
            stream_id,
            MAX(CASE WHEN event_type IN ${sql.in(NON_ACTIVITY_EVENT_TYPES)} THEN NULL
              ELSE sequence END) AS newest_activity
          FROM orchestration_events
          WHERE aggregate_kind = 'thread' AND application_event_version = 2
          GROUP BY stream_id
        `.pipe(NodeSqliteClient.readOnly);
        let foldedEntityCount = 0;
        let deletedEventCount = 0;
        let transactionCount = 0;
        let longestTransactionNanos = 0n;
        for (const stream of streams) {
          if (stream.newest_activity === null) continue;
          const rows = yield* sql<{
            readonly sequence: number;
            readonly event_type: string;
            readonly entity_id: string | null;
            readonly retained: number;
          }>`
            SELECT
              sequence,
              event_type,
              json_extract(payload_json, '$.id') AS entity_id,
              (command_id IS NOT NULL
                OR (event_type = 'turn-item.updated'
                  AND json_extract(payload_json, '$.type') = 'subagent')) AS retained
            FROM orchestration_events
            WHERE aggregate_kind = 'thread'
              AND application_event_version = 2
              AND stream_id = ${stream.stream_id}
              AND event_type IN ${sql.in(FOLDABLE_SNAPSHOT_EVENT_TYPES)}
            ORDER BY sequence ASC
          `.pipe(NodeSqliteClient.readOnly);
          const byEntity = new Map<string, Array<(typeof rows)[number]>>();
          for (const row of rows) {
            if (row.entity_id === null) continue;
            const key = encodeEntityKey([row.event_type, stream.stream_id, row.entity_id]);
            const group = byEntity.get(key);
            if (group === undefined) byEntity.set(key, [row]);
            else group.push(row);
          }
          const folds: Array<{ readonly into: number; readonly from: number; obsolete: number[] }> =
            [];
          for (const group of byEntity.values()) {
            const newest = group.at(-1)!;
            if (
              group.length < 2 ||
              // Commanded rows answer command-result replay; subagent rows anchor prompts.
              group.some((row) => row.retained !== 0) ||
              newest.sequence > options.settledThrough ||
              // Replay sets projection.updatedAt from the last activity event. Deleting it would
              // move updatedAt back; it also covers the stream's newest row, whose removal would
              // lower the snapshot sequence and reuse its stream_version.
              newest.sequence >= stream.newest_activity
            ) {
              continue;
            }
            folds.push({
              into: group[0]!.sequence,
              from: newest.sequence,
              obsolete: group.slice(1).map((row) => row.sequence),
            });
          }
          // Bounded transactions keep the writer free for live turns between chunks. Each chunk
          // raises the watermark over its own deletions, so a pass can stop after any chunk.
          for (let start = 0; start < folds.length; start += FOLD_ENTITIES_PER_TRANSACTION) {
            const chunk = folds.slice(start, start + FOLD_ENTITIES_PER_TRANSACTION);
            const obsolete = chunk.flatMap((fold) => fold.obsolete);
            const began = yield* Clock.monotonicTimeNanos;
            yield* sql.withTransaction(
              Effect.gen(function* () {
                for (const fold of chunk) {
                  yield* sql`
                    UPDATE orchestration_events
                    SET payload_json = (
                      SELECT payload_json FROM orchestration_events WHERE sequence = ${fold.from}
                    )
                    WHERE sequence = ${fold.into}
                  `;
                }
                for (let page = 0; page < obsolete.length; page += COMPACTION_PAGE_SIZE) {
                  yield* sql`DELETE FROM orchestration_events WHERE sequence IN ${sql.in(
                    obsolete.slice(page, page + COMPACTION_PAGE_SIZE),
                  )}`;
                }
                const watermark = obsolete.reduce((max, sequence) => Math.max(max, sequence), 0);
                const now = DateTime.formatIso(yield* DateTime.now);
                yield* sql`
                  INSERT INTO orchestration_v2_projection_metadata (
                    projection_name,
                    schema_version,
                    last_sequence,
                    updated_at
                  )
                  VALUES (${snapshotFoldThreadMetadataName(stream.stream_id)}, 1, ${watermark}, ${now})
                  ON CONFLICT(projection_name) DO UPDATE SET
                    last_sequence = MAX(last_sequence, excluded.last_sequence),
                    updated_at = excluded.updated_at
                `;
              }),
            );
            const held = (yield* Clock.monotonicTimeNanos) - began;
            if (held > longestTransactionNanos) longestTransactionNanos = held;
            transactionCount += 1;
            foldedEntityCount += chunk.length;
            deletedEventCount += obsolete.length;
            yield* Effect.yieldNow;
            yield* betweenPages;
          }
          yield* Effect.yieldNow;
          yield* betweenPages;
        }
        // Watermarks of threads with no events left guard nothing. Round-1 builds of this
        // experiment also wrote a global row that no reader uses any more.
        yield* sql`
          DELETE FROM orchestration_v2_projection_metadata
          WHERE projection_name = ${SNAPSHOT_FOLD_METADATA_NAME}
            OR (
              projection_name LIKE ${`${SNAPSHOT_FOLD_METADATA_NAME}:%`}
              AND NOT EXISTS (
                SELECT 1 FROM orchestration_events
                WHERE aggregate_kind = 'thread'
                  AND stream_id = substr(
                    projection_name,
                    ${SNAPSHOT_FOLD_METADATA_NAME.length + 2}
                  )
              )
            )
        `;
        return {
          foldedEntityCount,
          deletedEventCount,
          transactionCount,
          longestTransactionMillis: Number(longestTransactionNanos / 1000n) / 1000,
        };
      },
      mapError("fold superseded snapshots"),
    );

    return ProjectionMaintenanceV2.of({
      verify: mapError("verify")(verify),
      rebuild: mapError("rebuild")(rebuild),
      compactEventStore,
      foldSupersededSnapshots,
    });
  }),
);
