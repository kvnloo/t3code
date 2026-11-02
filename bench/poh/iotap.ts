// Reads the counters written by the bench-only LD_PRELOAD tap (iotap.c) for one server process.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

// Order matches the enum in iotap.c.
const COUNTER_NAMES = [
  "walBytes",
  "walWrites",
  "walFrames",
  "walCommits",
  "walHeaders",
  "dbBytes",
  "dbWrites",
  "shmBytes",
  "otherBytes",
  "walSyncs",
  "dbSyncs",
  "journalBytes",
] as const;

export type IoTap = Record<(typeof COUNTER_NAMES)[number], number>;

/** The tap counters for `pid`, or undefined when the tap is off or has not written yet. */
export function readIoTap(dir: string | undefined, pid: number): IoTap | undefined {
  if (dir === undefined) return undefined;
  let buffer: Buffer;
  try {
    buffer = NodeFS.readFileSync(NodePath.join(dir, `${pid}.iotap`));
  } catch {
    return undefined;
  }
  return Object.fromEntries(
    COUNTER_NAMES.map((name, i) => [name, Number(buffer.readBigUInt64LE(i * 8))]),
  ) as IoTap;
}

export function diffIoTap(before: IoTap | undefined, after: IoTap | undefined) {
  if (after === undefined) return undefined;
  return Object.fromEntries(
    COUNTER_NAMES.map((name) => [name, after[name] - (before?.[name] ?? 0)]),
  ) as IoTap;
}
