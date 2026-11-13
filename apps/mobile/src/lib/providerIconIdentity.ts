import { resolveOfficialAcpRegistryIconUrl } from "@t3tools/contracts";

export type ProviderIconIdentity = "hermes";

export function resolveProviderIconIdentity(input: {
  readonly driver: string;
  readonly settings?: unknown;
}): ProviderIconIdentity | null {
  if (input.driver !== "acpRegistry") return null;
  const settings = input.settings;
  if (typeof settings !== "object" || settings === null || !("source" in settings)) return null;
  if (settings.source === "registry") {
    return "agentId" in settings && settings.agentId === "hermes" ? "hermes" : null;
  }
  if (
    settings.source !== "local" ||
    !("commandPath" in settings) ||
    typeof settings.commandPath !== "string"
  ) {
    return null;
  }
  const executable = settings.commandPath.trim().split(/[\\/]/u).at(-1)?.toLowerCase();
  return executable === "hermes" ||
    executable === "hermes.exe" ||
    executable === "hermes-acp" ||
    executable === "hermes-acp.exe"
    ? "hermes"
    : null;
}

export type ProviderIconImageState = {
  readonly iconUrl: string;
  readonly status: "loaded" | "failed";
} | null;

export function resolveProviderIconImage(
  source: string | null | undefined,
  image: ProviderIconImageState,
) {
  const iconUrl = resolveOfficialAcpRegistryIconUrl(source);
  const currentImage = iconUrl !== null && image?.iconUrl === iconUrl ? image : null;
  return {
    iconUrl,
    loaded: currentImage?.status === "loaded",
    failed: currentImage?.status === "failed",
  };
}
