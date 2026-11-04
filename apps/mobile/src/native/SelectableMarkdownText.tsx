import { useMemo } from "react";
import { Platform, View } from "react-native";
import { splitOpenUiMarkdown } from "../lib/openUiMarkdown";
import { MarkdownOpenUiReport } from "./MarkdownOpenUiReport";
import type { SelectableMarkdownTextProps } from "./SelectableMarkdownText.types";

import { MobileEnrichedMarkdownText } from "./EnrichedMarkdownText";
import { themeColorWithAlpha } from "../lib/mobileTheme";
import { useUniwindTheme } from "../lib/useUniwindTheme";

export type {
  MarkdownFileContextMenu,
  MarkdownFileContextMenuAction,
  MarkdownImageRenderer,
  MarkdownImageRequest,
  MarkdownImageSourceResolver,
  MarkdownLinkCustomization,
  NativeMarkdownTextStyle,
  SelectableMarkdownSkill,
} from "./SelectableMarkdownText.types";

export function SelectableMarkdownText(props: SelectableMarkdownTextProps) {
  const theme = useUniwindTheme();
  const selectionColor = themeColorWithAlpha(theme["--color-focus"], 0.32);
  const selectionHandleColor = theme["--color-focus"];
  const textStyle =
    Platform.OS === "android"
      ? { selectionColor, selectionHandleColor, ...props.textStyle }
      : props.textStyle;
  const parts = useMemo(() => splitOpenUiMarkdown(props.markdown), [props.markdown]);
  if (!parts.some((part) => part.kind === "report")) {
    return <MobileEnrichedMarkdownText {...props} textStyle={textStyle} />;
  }
  return <View>
    {parts.map((part, index) => part.kind === "report"
      ? <MarkdownOpenUiReport key={index} code={part.code} version={part.version} />
      : <MobileEnrichedMarkdownText key={index} {...props} markdown={part.text} textStyle={textStyle} />)}
  </View>;
}
