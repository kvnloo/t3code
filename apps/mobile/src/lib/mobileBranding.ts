export type MobileStageLabel = "Beta" | "Dev" | "Nightly" | "Preview";

export function resolveMobileStageLabel(appVariant: unknown): MobileStageLabel {
  if (appVariant === "development") return "Dev";
  if (appVariant === "nightly") return "Nightly";
  if (appVariant === "preview") return "Preview";
  return "Beta";
}
