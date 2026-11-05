import { createContext } from "react";
import type { MarkdownImageSourceResolver } from "./SelectableMarkdownText.types";

/** Thread-provided resolver; kept separate so normal Markdown does not load the gallery renderer. */
export const OpenUiImageResolverContext = createContext<MarkdownImageSourceResolver | undefined>(undefined);
