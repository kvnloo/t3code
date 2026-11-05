import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { createContext, use } from "react";

import { useAssetUrlState } from "../../assets/assetUrls";

/** Where an OpenUI card loads an image it names: a URL it can use as is, or a host file to sign. */
export type OpenUiImageTarget =
  | { readonly kind: "url"; readonly url: string }
  | {
      readonly kind: "asset";
      readonly environmentId: EnvironmentId;
      readonly resource: Extract<AssetResource, { readonly _tag: "media-file" }>;
    };

/**
 * Chat Markdown provides this so cards resolve image paths exactly like Markdown images do.
 * Without it (previews, tests) only http(s) URLs load.
 */
export const OpenUiImageSourceContext = createContext<((source: string) => OpenUiImageTarget | null) | null>(
  null,
);

export type OpenUiImageState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly url: string }
  | { readonly status: "unavailable" };

/** The image's URL once known. A host file is signed through the same asset route as chat images. */
export function useOpenUiImage(source: string): OpenUiImageState {
  const resolve = use(OpenUiImageSourceContext);
  const target: OpenUiImageTarget | null = resolve
    ? resolve(source)
    : /^https?:\/\//i.test(source)
      ? { kind: "url", url: source }
      : null;
  const asset = useAssetUrlState(
    target?.kind === "asset" ? target.environmentId : null,
    target?.kind === "asset" ? target.resource : null,
  );
  if (target === null) return { status: "unavailable" };
  if (target.kind === "url") return { status: "ready", url: target.url };
  if (asset._tag === "Success") return { status: "ready", url: asset.url };
  if (asset._tag === "Failure") return { status: "unavailable" };
  return { status: "loading" };
}
