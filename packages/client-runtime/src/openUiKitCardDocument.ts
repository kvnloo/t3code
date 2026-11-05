/**
 * Builds the sandboxed document that draws ephemeral-ui cards. Kept apart from openUiKitCards.ts
 * because the generated kit is large: clients load this module only when a board has kit cards.
 */
import {
  EPHEMERAL_UI_KIT_HEAD,
  EPHEMERAL_UI_KIT_REVISION,
  EPHEMERAL_UI_KIT_TAIL,
} from "./ephemeralUiKitDocument.generated.ts";
import type { KitCard } from "./openUiKitCards.ts";

export const KIT_REVISION = EPHEMERAL_UI_KIT_REVISION;

export function kitCardsDocument(cards: ReadonlyArray<KitCard>, scheme: "light" | "dark"): string {
  // The list sits inside a <script>; escaping "<" keeps any string from closing it.
  const config = JSON.stringify({ scheme, cards }).replaceAll("<", "\\u003c");
  return EPHEMERAL_UI_KIT_HEAD + config + EPHEMERAL_UI_KIT_TAIL;
}
