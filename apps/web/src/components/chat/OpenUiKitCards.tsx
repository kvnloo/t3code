import { defineComponent } from "@openuidev/react-lang";
import {
  KIT_CARD_KINDS,
  KIT_CARD_LIMITS as LIMITS,
  KIT_CARD_OPTION_KEYS,
  KIT_CARDS_DESCRIPTION,
  kitIntentReadout,
  parseKitCardMessage,
  type KitCardIntent,
} from "@t3tools/client-runtime/openui-kit-cards";
import { memo, useEffect, useRef, useState } from "react";
import { z } from "zod/v4";

import { useRenderedAppearance } from "~/hooks/useTheme";

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

// The generated kit is large, so it loads only once a board actually has kit cards.
const loadDocument = () => import("@t3tools/client-runtime/openui-kit-card-document");

export const KitCardsPanel = memo(function KitCardsPanel({ props }: { props: KitCardsProps }) {
  const scheme = useRenderedAppearance() === "light" ? "light" : "dark";
  const frame = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<{ html: string; revision: string } | null>(null);
  const [height, setHeight] = useState(320);
  const [intent, setIntent] = useState<KitCardIntent | null>(null);
  const [errors, setErrors] = useState<ReadonlyArray<string>>([]);

  // Re-render the document only when the cards themselves change, not on every parent render.
  const cards = JSON.stringify(props.cards);
  useEffect(() => {
    let live = true;
    void loadDocument().then((module) => {
      if (live)
        setDoc({
          html: module.kitCardsDocument(JSON.parse(cards), scheme),
          revision: module.KIT_REVISION,
        });
    });
    return () => {
      live = false;
    };
  }, [cards, scheme]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = parseKitCardMessage(event.data);
      if (message?.type === "height") setHeight(message.value);
      else if (message?.type === "intent") setIntent(message.intent);
      else if (message?.type === "error")
        setErrors((current) => [...current, `${message.kind}: ${message.reason}`].slice(-4));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <section aria-label={props.title} className="min-w-0 space-y-2" data-openui-kit-cards="">
      <h4 className="font-semibold">{props.title}</h4>
      {doc === null ? (
        <p role="status" className="text-muted-foreground">
          Loading ephemeral-ui cards…
        </p>
      ) : (
        // No allow-same-origin: the kit runs in an opaque origin with no network (its CSP) and no host access.
        <iframe
          ref={frame}
          title={props.title}
          sandbox="allow-scripts"
          srcDoc={doc.html}
          className="block w-full border-0"
          style={{ height, colorScheme: scheme }}
        />
      )}
      <div aria-live="polite" className="rounded-md bg-secondary p-2.5 text-xs">
        <p>{kitIntentReadout(intent)}</p>
        {errors.map((error) => (
          <p key={error} className="text-muted-foreground">
            {error}
          </p>
        ))}
        {doc && <p className="text-muted-foreground">ephemeral-ui {doc.revision.slice(0, 7)}</p>}
      </div>
    </section>
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
