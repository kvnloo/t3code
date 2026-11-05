/**
 * Gallery card for the `openui-v2` catalog: a swipeable carousel of images the agent already has,
 * in the ephemeral-ui card style (accent per group, caption over the picture, thumbnails, tags).
 * Read-only like the other cards: swiping and selecting stay local and nothing is fetched beyond
 * the images themselves, which each client resolves the same way it resolves Markdown images.
 */

export const GALLERY_LIMITS = {
  slides: 24,
  title: 200,
  caption: 160,
  note: 600,
  group: 60,
  tag: 40,
  tags: 6,
  source: 2_000,
} as const;

export const GALLERY_TONES = ["ok", "warn", "bad", "info"] as const;
export type GalleryTone = (typeof GALLERY_TONES)[number];

export const GALLERY_DESCRIPTION =
  "Swipeable carousel of images: a title, then slides in order. Each slide has an image (an absolute file path, a workspace-relative path or an https URL the agent already has), a title and optionally a caption, a group name (slides of one project share a group and its accent), short tags with a tone (ok, warn, bad or info), a one-paragraph note and an https link. Never invent images.";

export const GALLERY_PROMPT_RULE =
  "Gallery images must be files or URLs from this turn or the workspace; never invent a path. Give slides of one subject the same group.";

export const GALLERY_EXAMPLE =
  'root = Board("Trading terminals", "Native picks, best design first.", [shots])\nshots = Gallery("Native trading terminals", [{image: "/abs/path/terminal.jpg", title: "Terminal", caption: "Bloomberg amber theme", group: "Terminal", tags: [{text: "Rust · egui", tone: "ok"}, {text: "no licence", tone: "bad"}], note: "Best design; no licence yet.", link: "https://github.com/michaelshimeles/terminal"}])';

export interface GalleryTag {
  readonly text: string;
  readonly tone: GalleryTone;
}

export interface GallerySlide {
  readonly image: string;
  readonly title: string;
  readonly caption?: string | undefined;
  readonly group?: string | undefined;
  readonly tags?: ReadonlyArray<GalleryTag> | undefined;
  readonly note?: string | undefined;
  readonly link?: string | undefined;
}

export interface GalleryPanel {
  readonly typeName: "Gallery";
  readonly props: { readonly title: string; readonly slides: ReadonlyArray<GallerySlide> };
}

/** Accents in the ephemeral-ui palette, readable under dark ink on light and dark themes. */
export const GALLERY_ACCENTS = [
  "#f5a524",
  "#22d3ee",
  "#a78bfa",
  "#34d399",
  "#60a5fa",
  "#fb7185",
  "#facc15",
  "#f97316",
] as const;

/** Text drawn on an accent chip. Every accent above is light enough for near-black ink. */
export const GALLERY_ACCENT_INK = "#111111";

/** A slide's group key: its group, or its own title when it has none. */
export function galleryGroupKey(slide: GallerySlide): string {
  return (slide.group ?? slide.title).trim();
}

/** Distinct groups in reading order, each with its accent and the index of its first slide. */
export function galleryGroups(
  slides: ReadonlyArray<GallerySlide>,
): ReadonlyArray<{ readonly key: string; readonly accent: string; readonly first: number }> {
  const groups: Array<{ key: string; accent: string; first: number }> = [];
  slides.forEach((slide, index) => {
    const key = galleryGroupKey(slide);
    if (!groups.some((group) => group.key === key)) {
      groups.push({ key, accent: GALLERY_ACCENTS[groups.length % GALLERY_ACCENTS.length]!, first: index });
    }
  });
  return groups;
}

/** The accent of the slide at `index`. */
export function galleryAccent(slides: ReadonlyArray<GallerySlide>, index: number): string {
  const slide = slides[index];
  if (!slide) return GALLERY_ACCENTS[0];
  const key = galleryGroupKey(slide);
  return galleryGroups(slides).find((group) => group.key === key)?.accent ?? GALLERY_ACCENTS[0];
}

/** Wrap an index into [0, length). */
export function galleryIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

/** Which slide a horizontal swipe lands on: past a quarter of the width, or a fast flick. */
export function gallerySwipeTarget(
  index: number,
  length: number,
  dx: number,
  width: number,
  velocity = 0,
): number {
  const far = width > 0 && Math.abs(dx) > width * 0.25;
  const flick = Math.abs(velocity) > 0.5 && Math.abs(dx) > 12;
  if (!far && !flick) return index;
  return galleryIndex(index + (dx < 0 ? 1 : -1), length);
}

/** "3 / 15". */
export function galleryCounter(index: number, length: number): string {
  return `${galleryIndex(index, length) + 1} / ${length}`;
}

/** What a screen reader hears for a slide. */
export function gallerySlideLabel(slide: GallerySlide, index: number, length: number): string {
  const parts = [slide.title, slide.caption, galleryCounter(index, length)].filter(Boolean);
  return parts.join(", ");
}

const HTTP_URL = /^https?:\/\//i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Image sources the catalog accepts: http(s) URLs and file paths. No data:, javascript: or other schemes. */
export function isGalleryImageSource(source: string): boolean {
  const value = source.trim();
  if (value.length === 0 || value.length > GALLERY_LIMITS.source) return false;
  if (HTTP_URL.test(value)) return true;
  if (/^[a-z]:[\\/]/i.test(value)) return true; // Windows drive path
  if (value.startsWith("file://")) return true;
  return !SCHEME.test(value);
}

/** Cross-field rules the schema cannot express. */
export function galleryProblem(panel: GalleryPanel): string | null {
  const bad = panel.props.slides.find((slide) => !isGalleryImageSource(slide.image));
  if (bad) return `Gallery slide "${bad.title}" needs a file path or an https image.`;
  const link = panel.props.slides.find((slide) => slide.link !== undefined && !HTTP_URL.test(slide.link));
  if (link) return `Gallery slide "${link.title}" link must be an http(s) URL.`;
  return null;
}
