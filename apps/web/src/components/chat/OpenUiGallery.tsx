import { defineComponent } from "@openuidev/react-lang";
import {
  GALLERY_ACCENT_INK,
  GALLERY_DESCRIPTION,
  GALLERY_LIMITS as LIMITS,
  GALLERY_TONES,
  galleryAccent,
  galleryCounter,
  galleryGroupKey,
  galleryGroups,
  galleryIndex,
  gallerySlideLabel,
  gallerySwipeTarget,
} from "@t3tools/client-runtime/openui-gallery";
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, ImageOffIcon, Maximize2Icon, StarIcon, XIcon } from "lucide-react";
import { memo, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { z } from "zod/v4";

import { cn } from "../../lib/utils";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { useOpenUiImage } from "./openUiImageSource";

const short = (max: number) => z.string().max(max);
export const galleryProps = z.object({
  title: short(LIMITS.title),
  slides: z
    .array(
      z.object({
        image: z.string().min(1).max(LIMITS.source),
        title: z.string().min(1).max(LIMITS.title),
        caption: short(LIMITS.caption).optional(),
        group: short(LIMITS.group).optional(),
        tags: z
          .array(z.object({ text: z.string().min(1).max(LIMITS.tag), tone: z.enum(GALLERY_TONES) }))
          .max(LIMITS.tags)
          .optional(),
        note: short(LIMITS.note).optional(),
        link: z.url({ protocol: /^https?$/ }).max(LIMITS.source).optional(),
      }),
    )
    .min(1)
    .max(LIMITS.slides),
});
type GalleryProps = z.infer<typeof galleryProps>;
type Slide = GalleryProps["slides"][number];

const TONE_CLASS: Record<(typeof GALLERY_TONES)[number], string> = {
  ok: "border-success/60 text-success",
  warn: "border-warning/60 text-warning",
  bad: "border-destructive/60 text-destructive",
  info: "border-info/60 text-info",
};

const EASE = "cubic-bezier(.22,1,.36,1)";

function SlideImage({ slide, fit, className }: { slide: Slide; fit: "cover" | "contain"; className?: string }) {
  const image = useOpenUiImage(slide.image);
  if (image.status === "ready") {
    return (
      <img
        src={image.url}
        alt=""
        draggable={false}
        className={cn("pointer-events-none block size-full select-none", fit === "cover" ? "object-cover object-left-top" : "object-contain", className)}
      />
    );
  }
  return (
    <div className="flex size-full items-center justify-center gap-2 text-xs text-white/70">
      {image.status === "loading" ? <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white/80" /> : <ImageOffIcon className="size-4" />}
      {image.status === "loading" ? null : <span>Image unavailable</span>}
    </div>
  );
}

function Lightbox({ slides, index, onIndex, onClose }: { slides: ReadonlyArray<Slide>; index: number; onIndex: (next: number) => void; onClose: () => void }) {
  const slide = slides[index]!;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPopup
        variant="media"
        bottomStickOnMobile={false}
        showCloseButton={false}
        aria-label={gallerySlideLabel(slide, index, slides.length)}
        className="flex h-[85dvh] w-[92vw] max-w-none flex-col bg-black/90 p-4"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.stopPropagation();
            onIndex(index + (event.key === "ArrowRight" ? 1 : -1));
          }
        }}
      >
      <DialogTitle className="sr-only">{gallerySlideLabel(slide, index, slides.length)}</DialogTitle>
      <div className="flex items-center gap-3 text-white">
        <span className="min-w-0 flex-1 truncate text-sm">
          <b>{slide.title}</b>
          {slide.caption ? <span className="text-white/70"> · {slide.caption}</span> : null}
        </span>
        <span className="font-mono text-xs text-white/70">{galleryCounter(index, slides.length)}</span>
        <button type="button" aria-label="Close" onClick={onClose} className="grid size-9 place-items-center rounded-full bg-white/10 hover:bg-white/20">
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="relative mt-3 min-h-0 flex-1" onClick={(event) => event.target === event.currentTarget && onClose()}>
        <SlideImage slide={slide} fit="contain" />
        <NavButton side="left" onClick={() => onIndex(index - 1)} />
        <NavButton side="right" onClick={() => onIndex(index + 1)} />
      </div>
      </DialogPopup>
    </Dialog>
  );
}

function NavButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Previous image" : "Next image"}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "absolute top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full border border-white/25 bg-black/45 text-white backdrop-blur-md transition-transform hover:bg-black/70 active:scale-90",
        side === "left" ? "left-2.5" : "right-2.5",
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}

export const GalleryPanel = memo(function GalleryPanel({ props }: { props: GalleryProps }) {
  const slides = props.slides;
  const groups = galleryGroups(slides);
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const stage = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; t: number } | null>(null);
  const thumbs = useRef<HTMLDivElement>(null);
  const current = galleryIndex(index, slides.length);
  const slide = slides[current]!;
  const accent = galleryAccent(slides, current);
  const group = galleryGroupKey(slide);
  const go = (next: number) => setIndex(galleryIndex(next, slides.length));

  useEffect(() => {
    const strip = thumbs.current;
    const thumb = strip?.children[current] as HTMLElement | undefined;
    if (strip && thumb) strip.scrollTo({ left: thumb.offsetLeft - strip.clientWidth / 2 + thumb.clientWidth / 2, behavior: "smooth" });
  }, [current]);

  const onPointerDown = (event: ReactPointerEvent) => {
    if ((event.target as HTMLElement).closest("button")) return;
    start.current = { x: event.clientX, t: event.timeStamp };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDrag(0);
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    if (start.current) setDrag(event.clientX - start.current.x);
  };
  const onPointerUp = (event: ReactPointerEvent) => {
    const began = start.current;
    start.current = null;
    setDrag(null);
    if (!began) return;
    const dx = event.clientX - began.x;
    const velocity = dx / Math.max(1, event.timeStamp - began.t);
    if (Math.abs(dx) < 6) {
      setExpanded(true);
      return;
    }
    go(gallerySwipeTarget(current, slides.length, dx, stage.current?.clientWidth ?? 0, velocity));
  };

  const accentStyle = { "--gallery-accent": accent, "--gallery-ink": GALLERY_ACCENT_INK } as CSSProperties;
  return (
    <section
      aria-label={props.title}
      aria-roledescription="carousel"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") go(current + 1);
        if (event.key === "ArrowLeft") go(current - 1);
      }}
      className="min-w-0 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[0_1px_2px_rgb(0_0_0/.04),0_8px_24px_-16px_rgb(0_0_0/.35)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={accentStyle}
      data-openui-gallery=""
    >
      <header className="flex items-center gap-2.5 px-4 pt-3 pb-2">
        <span
          aria-hidden
          className="grid size-[26px] shrink-0 place-items-center rounded-[7px] font-mono text-[11px] font-bold transition-colors duration-500"
          style={{ background: "var(--gallery-accent)", color: "var(--gallery-ink)" }}
        >
          {String(groups.findIndex((entry) => entry.key === group) + 1).padStart(2, "0")}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <b className="truncate text-sm">{props.title}</b>
          <span className="truncate text-xs text-muted-foreground">{slide.title}{slide.caption ? ` · ${slide.caption}` : ""}</span>
        </span>
        <span className="shrink-0 rounded-full bg-secondary px-2 py-1 font-mono text-[11px] text-muted-foreground" aria-live="polite">
          {picked.size ? `${picked.size} starred` : galleryCounter(current, slides.length)}
        </span>
      </header>

      <div
        ref={stage}
        className="relative mx-3 aspect-[16/10] touch-pan-y overflow-hidden rounded-lg bg-black select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          start.current = null;
          setDrag(null);
        }}
      >
        <div
          className="flex h-full"
          style={{
            transform: `translateX(calc(${-current * 100}% + ${drag ?? 0}px))`,
            transition: drag === null ? `transform .55s ${EASE}` : "none",
          }}
        >
          {slides.map((entry, position) => (
            <div
              key={position}
              role="group"
              aria-roledescription="slide"
              aria-label={gallerySlideLabel(entry, position, slides.length)}
              aria-hidden={position !== current}
              className="relative h-full w-full shrink-0"
            >
              {position === current || position === galleryIndex(current + 1, slides.length) || position === galleryIndex(current - 1, slides.length) ? (
                <SlideImage slide={entry} fit="cover" />
              ) : null}
            </div>
          ))}
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%] bg-gradient-to-t from-black/85 to-transparent" />
        <div key={current} className="pointer-events-none absolute inset-x-3.5 bottom-3 flex items-end gap-2.5 text-white motion-safe:animate-[openui-gallery-in_.45s_cubic-bezier(.22,1,.36,1)]">
          <span className="rounded-md px-1.5 py-1 font-mono text-[11px] leading-none font-semibold" style={{ background: "var(--gallery-accent)", color: "var(--gallery-ink)" }}>
            {slide.group ?? slide.title}
          </span>
          <span className="min-w-0">
            <b className="block truncate text-[17px] leading-tight">{slide.title}</b>
            {slide.caption ? <span className="block truncate text-xs opacity-85">{slide.caption}</span> : null}
          </span>
        </div>
        {slides.length > 1 ? (
          <>
            <NavButton side="left" onClick={() => go(current - 1)} />
            <NavButton side="right" onClick={() => go(current + 1)} />
          </>
        ) : null}
        <button
          type="button"
          aria-label="View full size"
          onClick={() => setExpanded(true)}
          className="absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-full bg-black/50 text-white backdrop-blur-md hover:bg-black/70"
        >
          <Maximize2Icon className="size-3.5" />
        </button>
      </div>

      {slides.length > 1 ? (
        <div ref={thumbs} className="flex gap-1.5 overflow-x-auto px-3 pt-2.5 pb-1 [scrollbar-width:none]">
          {slides.map((entry, position) => {
            const active = position === current;
            return (
              <button
                key={position}
                type="button"
                aria-label={`Show ${gallerySlideLabel(entry, position, slides.length)}`}
                aria-current={active}
                onClick={() => go(position)}
                className={cn(
                  "h-[42px] w-[72px] shrink-0 overflow-hidden rounded-md border-2 bg-black transition-[opacity,transform,border-color] duration-300",
                  active ? "-translate-y-0.5 opacity-100" : "border-transparent opacity-50 hover:opacity-85",
                )}
                style={active ? { borderColor: "var(--gallery-accent)" } : undefined}
              >
                <SlideImage slide={entry} fit="cover" />
              </button>
            );
          })}
        </div>
      ) : null}

      {groups.length > 1 ? (
        <div aria-hidden className="flex justify-center gap-1.5 pt-1.5">
          {groups.map((entry) => (
            <span
              key={entry.key}
              className="h-1 rounded-sm transition-[width,background-color] duration-300"
              style={{ width: entry.key === group ? 28 : 14, background: entry.key === group ? entry.accent : "color-mix(in srgb, currentColor 12%, transparent)" }}
            />
          ))}
        </div>
      ) : null}

      <div key={group} className="flex min-h-12 flex-col gap-2 px-4 pt-2.5 pb-1 motion-safe:animate-[openui-gallery-in_.45s_cubic-bezier(.22,1,.36,1)]">
        {slide.tags?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {slide.tags.map((tag, position) => (
              <span key={position} className={cn("rounded-full border px-2 py-1 font-mono text-[11px] leading-none", TONE_CLASS[tag.tone])}>
                {tag.text}
              </span>
            ))}
          </div>
        ) : null}
        {slide.note ? <p className="m-0 text-[13px] leading-snug">{slide.note}</p> : null}
      </div>

      <footer className="mt-2 flex flex-wrap items-center gap-2 border-t border-border px-4 pt-2.5 pb-3">
        <button
          type="button"
          aria-pressed={picked.has(group)}
          onClick={() =>
            setPicked((previous) => {
              const next = new Set(previous);
              if (next.has(group)) next.delete(group);
              else next.add(group);
              return next;
            })
          }
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-transform active:scale-[.97]"
          style={{ background: "var(--gallery-accent)", color: "var(--gallery-ink)" }}
        >
          <StarIcon className={cn("size-3.5", picked.has(group) && "fill-current")} />
          {picked.has(group) ? "Starred" : "Star"}
        </button>
        {slide.link ? (
          <a
            href={slide.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium hover:bg-secondary"
          >
            Open <ExternalLinkIcon className="size-3.5" />
          </a>
        ) : null}
        <span className="ml-auto text-[11.5px] text-muted-foreground">swipe · ← → · tap to enlarge</span>
      </footer>
      {expanded ? <Lightbox slides={slides} index={current} onIndex={go} onClose={() => setExpanded(false)} /> : null}
    </section>
  );
});

export const Gallery = defineComponent({ name: "Gallery", description: GALLERY_DESCRIPTION, props: galleryProps, component: GalleryPanel });
export const gallerySchema = { Gallery: (value: unknown) => galleryProps.safeParse(value) };
