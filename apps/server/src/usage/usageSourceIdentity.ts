/**
 * Cross-runtime usage source identity.
 *
 * Desktop-managed Windows and WSL backends can read the same NTFS transcript
 * directory through different path and inode namespaces. The desktop gives
 * both backends one non-secret host scope; only drive-backed Windows/WSL paths
 * normalize into the same physical path.
 */
const WINDOWS_DRIVE_PATH = /^([A-Za-z]):[\\/](.*)$/;
const WSL_DRIVE_PATH = /^\/mnt\/([A-Za-z])(?:\/(.*))?$/;

function normalizeWindowsTail(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

export function normalizePhysicalUsageSourcePath(value: string): string | undefined {
  const windows = WINDOWS_DRIVE_PATH.exec(value);
  if (windows) {
    return `windows:${windows[1]!.toLowerCase()}:/${normalizeWindowsTail(windows[2] ?? "")}`;
  }

  const wsl = WSL_DRIVE_PATH.exec(value);
  if (wsl) {
    return `windows:${wsl[1]!.toLowerCase()}:/${normalizeWindowsTail(wsl[2] ?? "")}`;
  }

  return undefined;
}

export function usagePhysicalSourceId(
  hostScope: string | undefined,
  resolvedHomePath: string,
): string | undefined {
  const scope = hostScope?.trim();
  if (!scope) return undefined;
  const physicalPath = normalizePhysicalUsageSourcePath(resolvedHomePath);
  if (physicalPath === undefined) return undefined;
  return `${scope}\0${physicalPath}`;
}
