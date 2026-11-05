import { defineComponent } from "@openuidev/react-lang";
import { Image } from "expo-image";
import { memo, use, useEffect, useRef, useState, type ComponentRef } from "react";
import {
  Linking,
  useColorScheme,
  Modal,
  Pressable,
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";
import { z } from "zod/v4";

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
  type GalleryTone,
} from "@t3tools/client-runtime/openui-gallery";

import { AppText } from "../components/ui/AppText";
import { useUniwindTheme } from "../lib/useUniwindTheme";
import { OpenUiImageResolverContext } from "./openUiImageResolver";

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
type ImageSource = { uri: string; headers?: Record<string, string> };

const enter = FadeInDown.duration(380).reduceMotion(ReduceMotion.System);

/** Resolves a slide's image; retries when the thread hands over a new resolver (reconnects). */
function useSlideSource(image: string): ImageSource | "loading" | "unavailable" {
  const resolve = use(OpenUiImageResolverContext);
  const [state, setState] = useState<ImageSource | "loading" | "unavailable">("loading");
  useEffect(() => {
    if (/^https?:\/\//i.test(image)) {
      setState({ uri: image });
      return;
    }
    if (!resolve) {
      setState("unavailable");
      return;
    }
    let live = true;
    setState("loading");
    Promise.resolve()
      .then(() => resolve({ href: image, alt: null, title: null }))
      .then(
        (source) => live && setState(source ?? "unavailable"),
        () => live && setState("unavailable"),
      );
    return () => {
      live = false;
    };
  }, [image, resolve]);
  return state;
}

function SlideImage({ slide, fit }: { slide: Slide; fit: "cover" | "contain" }) {
  const source = useSlideSource(slide.image);
  if (typeof source === "object") {
    return (
      <Image
        source={source}
        style={{ width: "100%", height: "100%" }}
        contentFit={fit}
        contentPosition={fit === "cover" ? "left top" : "center"}
        transition={180}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <AppText style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
        {source === "loading" ? "Loading…" : "Image unavailable"}
      </AppText>
    </View>
  );
}

// Fixed tones: some themes' warning/danger tokens are too dark to read as text on a dark card.
const TONES: Record<GalleryTone, { dark: string; light: string }> = {
  ok: { dark: "#34d399", light: "#047857" },
  warn: { dark: "#fbbf24", light: "#b45309" },
  bad: { dark: "#fb7185", light: "#be123c" },
  info: { dark: "#60a5fa", light: "#1d4ed8" },
};

function toneColor(tone: GalleryTone, scheme: "dark" | "light") {
  return TONES[tone][scheme];
}

function RoundButton({ label, glyph, onPress, style }: { label: string; glyph: string; onPress: () => void; style?: object }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        {
          position: "absolute",
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(0,0,0,0.5)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.25)",
          transform: [{ scale: pressed ? 0.92 : 1 }],
        },
        style,
      ]}
    >
      <AppText style={{ color: "#fff", fontSize: 18, lineHeight: 20 }}>{glyph}</AppText>
    </Pressable>
  );
}

/** Horizontal pager that only mounts the visible slide and its neighbours. */
function Pager({
  slides,
  index,
  onIndex,
  fit,
  onTap,
}: {
  slides: ReadonlyArray<Slide>;
  index: number;
  onIndex: (next: number) => void;
  fit: "cover" | "contain";
  onTap?: () => void;
}) {
  const [width, setWidth] = useState(0);
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const settled = useRef(index);
  useEffect(() => {
    if (width > 0 && settled.current !== index) {
      settled.current = index;
      scroller.current?.scrollTo({ x: index * width, animated: true });
    }
  }, [index, width]);
  const onEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const next = galleryIndex(Math.round(event.nativeEvent.contentOffset.x / width), slides.length);
    settled.current = next;
    if (next !== index) onIndex(next);
  };
  const near = (position: number) =>
    position === index ||
    position === galleryIndex(index + 1, slides.length) ||
    position === galleryIndex(index - 1, slides.length);
  return (
    <View style={{ flex: 1 }} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? (
        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: index * width, y: 0 }}
          onMomentumScrollEnd={onEnd}
          nestedScrollEnabled
        >
          {slides.map((slide, position) => (
            <Pressable
              key={position}
              onPress={onTap}
              accessibilityRole={onTap ? "imagebutton" : "image"}
              accessibilityLabel={gallerySlideLabel(slide, position, slides.length)}
              accessibilityHint={onTap ? "Opens full size" : undefined}
              style={{ width, height: "100%" }}
            >
              {near(position) ? <SlideImage slide={slide} fit={fit} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const GalleryPanel = memo(function GalleryPanel({ props }: { props: GalleryProps }) {
  const theme = useUniwindTheme();
  const scheme = useColorScheme() === "light" ? "light" : "dark";
  const slides = props.slides;
  const groups = galleryGroups(slides);
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [starred, setStarred] = useState<ReadonlySet<string>>(new Set());
  const thumbs = useRef<ComponentRef<typeof ScrollView>>(null);
  const current = galleryIndex(index, slides.length);
  const slide = slides[current]!;
  const accent = galleryAccent(slides, current);
  const group = galleryGroupKey(slide);
  const groupNumber = String(groups.findIndex((entry) => entry.key === group) + 1).padStart(2, "0");
  const go = (next: number) => setIndex(galleryIndex(next, slides.length));
  useEffect(() => {
    thumbs.current?.scrollTo({ x: Math.max(0, current * 78 - 120), animated: true });
  }, [current]);
  const isStarred = starred.has(group);

  return (
    <View
      accessibilityLabel={props.title}
      style={{
        overflow: "hidden",
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme["--color-border"],
        backgroundColor: theme["--color-card"],
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 }}>
        <View style={{ width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: accent }}>
          <AppText style={{ color: GALLERY_ACCENT_INK, fontSize: 11, fontWeight: "700", fontFamily: "monospace" }}>{groupNumber}</AppText>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText numberOfLines={1} style={{ fontSize: 14, fontWeight: "600", color: theme["--color-foreground"] }}>{props.title}</AppText>
          <AppText numberOfLines={1} style={{ fontSize: 12, color: theme["--color-foreground-muted"] }}>
            {slide.title}{slide.caption ? ` · ${slide.caption}` : ""}
          </AppText>
        </View>
        <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: theme["--color-subtle"] }}>
          <AppText accessibilityLiveRegion="polite" style={{ fontSize: 11, fontFamily: "monospace", color: theme["--color-foreground-muted"] }}>
            {starred.size ? `${starred.size} starred` : galleryCounter(current, slides.length)}
          </AppText>
        </View>
      </View>

      <View style={{ marginHorizontal: 10, aspectRatio: 16 / 10, borderRadius: 10, overflow: "hidden", backgroundColor: "#000" }}>
        <Pager slides={slides} index={current} onIndex={go} fit="cover" onTap={() => setExpanded(true)} />
        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "46%", experimental_backgroundImage: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)" }} />
        <Animated.View key={current} entering={enter} pointerEvents="none" style={{ position: "absolute", left: 12, right: 12, bottom: 10, flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
          <View style={{ borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: accent }}>
            <AppText numberOfLines={1} style={{ color: GALLERY_ACCENT_INK, fontSize: 11, fontWeight: "600", fontFamily: "monospace" }}>{slide.group ?? slide.title}</AppText>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText numberOfLines={1} style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>{slide.title}</AppText>
            {slide.caption ? <AppText numberOfLines={1} style={{ color: "rgba(255,255,255,0.85)", fontSize: 12 }}>{slide.caption}</AppText> : null}
          </View>
        </Animated.View>
        {slides.length > 1 ? (
          <>
            <RoundButton label="Previous image" glyph="‹" onPress={() => go(current - 1)} style={{ left: 8, top: "50%", marginTop: -18 }} />
            <RoundButton label="Next image" glyph="›" onPress={() => go(current + 1)} style={{ right: 8, top: "50%", marginTop: -18 }} />
          </>
        ) : null}
      </View>

      {slides.length > 1 ? (
        <ScrollView ref={thumbs} horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled contentContainerStyle={{ gap: 6, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 4 }}>
          {slides.map((entry, position) => {
            const active = position === current;
            return (
              <Pressable
                key={position}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Show ${gallerySlideLabel(entry, position, slides.length)}`}
                onPress={() => go(position)}
                style={{
                  width: 72,
                  height: 42,
                  borderRadius: 6,
                  overflow: "hidden",
                  borderWidth: 2,
                  borderColor: active ? accent : "transparent",
                  opacity: active ? 1 : 0.5,
                  backgroundColor: "#000",
                  transform: [{ translateY: active ? -2 : 0 }],
                }}
              >
                <SlideImage slide={entry} fit="cover" />
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {groups.length > 1 ? (
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 5, paddingTop: 6 }}>
          {groups.map((entry) => (
            <View key={entry.key} style={{ height: 4, borderRadius: 2, width: entry.key === group ? 28 : 14, backgroundColor: entry.key === group ? entry.accent : theme["--color-foreground-muted"], opacity: entry.key === group ? 1 : 0.35 }} />
          ))}
        </View>
      ) : null}

      <Animated.View key={group} entering={enter} style={{ gap: 8, paddingHorizontal: 14, paddingTop: 10, minHeight: 40 }}>
        {slide.tags?.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {slide.tags.map((tag, position) => {
              const color = toneColor(tag.tone, scheme);
              return (
                <View key={position} style={{ borderRadius: 999, borderWidth: 1, borderColor: color, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <AppText style={{ color, fontSize: 11, fontFamily: "monospace" }}>{tag.text}</AppText>
                </View>
              );
            })}
          </View>
        ) : null}
        {slide.note ? <AppText selectable style={{ fontSize: 13, lineHeight: 19, color: theme["--color-foreground"] }}>{slide.note}</AppText> : null}
      </Animated.View>

      <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderTopColor: theme["--color-border"], paddingHorizontal: 14, paddingVertical: 10 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: isStarred }}
          onPress={() =>
            setStarred((previous) => {
              const next = new Set(previous);
              if (next.has(group)) next.delete(group);
              else next.add(group);
              return next;
            })
          }
          style={({ pressed }) => ({ borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: accent, transform: [{ scale: pressed ? 0.97 : 1 }] })}
        >
          <AppText style={{ color: GALLERY_ACCENT_INK, fontSize: 13, fontWeight: "600" }}>{isStarred ? "★ Starred" : "☆ Star"}</AppText>
        </Pressable>
        {slide.link ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL(slide.link!)}
            style={{ borderRadius: 8, borderWidth: 1, borderColor: theme["--color-border"], paddingHorizontal: 12, paddingVertical: 7 }}
          >
            <AppText style={{ fontSize: 13, fontWeight: "600", color: theme["--color-foreground"] }}>Open ↗</AppText>
          </Pressable>
        ) : null}
        <AppText style={{ marginLeft: "auto", fontSize: 11, color: theme["--color-foreground-muted"] }}>swipe · tap to enlarge</AppText>
      </View>

      <Modal visible={expanded} transparent animationType="fade" onRequestClose={() => setExpanded(false)} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: "#000", paddingTop: 44, paddingBottom: 24 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingBottom: 12 }}>
            <AppText numberOfLines={1} style={{ flex: 1, color: "#fff", fontSize: 14 }}>
              {slide.title}{slide.caption ? ` · ${slide.caption}` : ""}
            </AppText>
            <AppText style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "monospace" }}>{galleryCounter(current, slides.length)}</AppText>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={() => setExpanded(false)} style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" }}>
              <AppText style={{ color: "#fff", fontSize: 16 }}>✕</AppText>
            </Pressable>
          </View>
          <Pager slides={slides} index={current} onIndex={go} fit="contain" />
        </View>
      </Modal>
    </View>
  );
});

export const Gallery = defineComponent({ name: "Gallery", description: GALLERY_DESCRIPTION, props: galleryProps, component: GalleryPanel });
export const gallerySchema = { Gallery: (value: unknown) => galleryProps.safeParse(value) };
