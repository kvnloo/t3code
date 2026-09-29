import type { File } from "expo-file-system";

let tempFileSequence = 0;

/**
 * Replaces a file's contents through a sibling temp file and an overwriting
 * rename, so an interrupted write (app restart, process death) never leaves a
 * truncated document at the final path. Each write stages through its own
 * temp file so concurrent writers to the same destination cannot move or
 * clobber each other's staging file mid-flight. A failed write removes its
 * staging file: the composer-draft and outbox writers retry after failures,
 * and every retry would otherwise leave one orphaned temp file behind.
 */
export async function writeFileAtomically(file: File, contents: string): Promise<void> {
  const { File: FileConstructor } = await import("expo-file-system");
  tempFileSequence += 1;
  const temp = new FileConstructor(file.parentDirectory, `${file.name}.${tempFileSequence}.tmp`);
  try {
    temp.create({ intermediates: true, overwrite: true });
    temp.write(contents);
    temp.moveSync(file, { overwrite: true });
  } catch (cause) {
    try {
      if (temp.exists) temp.delete();
    } catch {
      // Best effort: the original write error is what the caller sees.
    }
    throw cause;
  }
}
