import { defineComponent } from "@openuidev/react-lang";
import { memo, useMemo, useState } from "react";
import { useColorScheme, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { z } from "zod/v4";

import { KIT_REVISION, kitCardsDocument } from "@t3tools/client-runtime/openui-kit-card-document";
import {
  KIT_CARD_KINDS,
  KIT_CARD_LIMITS as LIMITS,
  KIT_CARD_OPTION_KEYS,
  KIT_CARDS_DESCRIPTION,
  kitIntentReadout,
  parseKitCardMessage,
  type KitCardIntent,
} from "@t3tools/client-runtime/openui-kit-cards";

import { AppText } from "../components/ui/AppText";

export const kitCardsProps = z.object({
  title: z.string().max(LIMITS.title),
  cards: z
    .array(
      z.object({
        kind: z.enum(KIT_CARD_KINDS),
        app: z
          .string()
          .min(1)
          .max(LIMITS.app)
          .regex(/^[a-z0-9-]+$/)
          .optional(),
        input: z.unknown().optional(),
        options: z
          .partialRecord(z.enum(KIT_CARD_OPTION_KEYS), z.string().max(LIMITS.app))
          .optional(),
      }),
    )
    .min(1)
    .max(LIMITS.cards),
});
type KitCardsProps = z.infer<typeof kitCardsProps>;

// The document is the kit's own offline page: no network, no navigation, no file access.
const KitCardsPanel = memo(function KitCardsPanel({ props }: { props: KitCardsProps }) {
  const scheme = useColorScheme() === "light" ? "light" : "dark";
  // Rebuild the document only when the cards themselves change, not on every parent render.
  const cards = JSON.stringify(props.cards);
  const html = useMemo(() => kitCardsDocument(JSON.parse(cards), scheme), [cards, scheme]);
  const [height, setHeight] = useState(320);
  const [intent, setIntent] = useState<KitCardIntent | null>(null);
  const [errors, setErrors] = useState<ReadonlyArray<string>>([]);
  const onMessage = (event: WebViewMessageEvent) => {
    const message = parseKitCardMessage(event.nativeEvent.data);
    if (message?.type === "height") setHeight(message.value);
    else if (message?.type === "intent") setIntent(message.intent);
    else if (message?.type === "error")
      setErrors((current) => [...current, `${message.kind}: ${message.reason}`].slice(-4));
  };
  return (
    <View accessibilityLabel={props.title} style={{ gap: 8 }}>
      <AppText accessibilityRole="header" className="text-base font-semibold">
        {props.title}
      </AppText>
      <WebView
        source={{ html }}
        originWhitelist={["*"]}
        onShouldStartLoadWithRequest={(request) =>
          request.url.startsWith("about:") || request.url.startsWith("data:")
        }
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        setSupportMultipleWindows={false}
        mixedContentMode="never"
        scrollEnabled={false}
        nestedScrollEnabled={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        style={{ height, backgroundColor: "transparent" }}
        containerStyle={{ backgroundColor: "transparent" }}
      />
      <View
        accessibilityLiveRegion="polite"
        className="rounded-md bg-secondary"
        style={{ padding: 10 }}
      >
        <AppText selectable className="text-xs">
          {kitIntentReadout(intent)}
        </AppText>
        {errors.map((error) => (
          <AppText key={error} selectable className="text-xs text-foreground-muted">
            {error}
          </AppText>
        ))}
        <AppText className="text-xs text-foreground-muted">
          ephemeral-ui {KIT_REVISION.slice(0, 7)}
        </AppText>
      </View>
    </View>
  );
});

export const EphemeralCards = defineComponent({
  name: "EphemeralCards",
  description: KIT_CARDS_DESCRIPTION,
  props: kitCardsProps,
  component: KitCardsPanel,
});
export const kitCardsSchema = {
  EphemeralCards: (value: unknown) => kitCardsProps.safeParse(value),
};
