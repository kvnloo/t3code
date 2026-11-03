import { defineComponent } from "@openuidev/react-lang";
import { Image } from "expo-image";
import { memo, useState, type ReactNode } from "react";
import { Linking, Pressable, Text, View, useColorScheme, type TextStyle } from "react-native";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";
import Svg, { Circle, G, Path, Rect, Image as SvgImage } from "react-native-svg";
import { z } from "zod/v4";

import { APP_BRANDS, type AppBrand, type AppBrandId } from "@t3tools/client-runtime/app-connectors";
import {
  MAP_PAINT,
  appCardTheme,
  projectPath,
  type AppCardFont,
  type AppCardTheme,
} from "@t3tools/client-runtime/app-card-themes";
import { OCTICONS, type OcticonName } from "@t3tools/client-runtime/octicons";
import {
  APP_CARD_DESCRIPTIONS as DESCRIPTIONS,
  APP_CARD_LIMITS as LIMITS,
  avatarColor,
  carClass,
  cheapestRide,
  checkCounts,
  checkTimeline,
  commitLaneX,
  formatSeconds,
  rideReadout,
  type CarClass,
} from "@t3tools/client-runtime/openui-app-cards";

const text = z.string().max(LIMITS.text);
const name = z.string().min(1).max(LIMITS.text);
const minutes = z.number().finite().min(0).max(LIMITS.minutes);
const latitude = z.number().finite().min(-90).max(90);
const longitude = z.number().finite().min(-180).max(180);
const seconds = z
  .number()
  .finite()
  .min(0)
  .max(LIMITS.minutes * 60);

export const rideOptionsProps = z.object({
  app: z.enum(["uber", "lyft"]),
  pickup: name,
  dropoff: name,
  options: z
    .array(
      z.object({
        name,
        minutes,
        price: z.string().min(1).max(LIMITS.price),
        seats: z.number().int().min(1).max(20),
        arrival: text.optional(),
      }),
    )
    .min(1)
    .max(LIMITS.rideOptions),
});
export const mailListProps = z.object({
  query: text,
  messages: z
    .array(
      z.object({
        from: name,
        subject: text,
        snippet: z.string().max(LIMITS.snippet),
        time: text,
        unread: z.boolean(),
        attachment: text.optional(),
      }),
    )
    .max(LIMITS.messages),
});
export const routeProps = z.object({
  origin: name,
  destination: name,
  mode: z.enum(["drive", "walk", "transit", "bike"]),
  minutes,
  distance: text,
  steps: z.array(name).max(LIMITS.steps),
  via: text.optional(),
  path: z
    .array(z.tuple([latitude, longitude]))
    .min(2)
    .max(LIMITS.pathPoints)
    .optional(),
  map: z
    .object({
      image: z.url({ protocol: /^https?$/ }).max(LIMITS.url),
      bounds: z.tuple([latitude, longitude, latitude, longitude]),
    })
    .optional(),
});
export const pullRequestProps = z.object({
  number: z.number().int().min(1),
  title: name,
  state: z.enum(["open", "conflict", "ready", "merged", "closed"]),
  head: name,
  base: name,
  checks: z
    .array(
      z.object({
        name,
        status: z.enum(["pass", "fail", "running", "skip"]),
        detail: text,
        started: seconds.optional(),
        seconds: seconds.optional(),
      }),
    )
    .max(LIMITS.checks),
  conflicts: z.number().int().min(0).max(10_000),
  commits: z
    .array(
      z.object({
        title: name,
        sha: z.string().min(4).max(12),
        author: name,
        age: text,
        lane: z.enum(["base", "head", "side"]),
        branch: text.optional(),
        conflict: z.boolean().optional(),
      }),
    )
    .max(LIMITS.commits)
    .optional(),
});

// Embedded by the expo-font plugin in app.config.ts; Android needs one family per weight.
const FONTS: Record<AppCardFont, Record<"regular" | "medium" | "bold", string>> = {
  "google-sans": {
    regular: "GoogleSans-Regular",
    medium: "GoogleSans-Medium",
    bold: "GoogleSans-Bold",
  },
  "inter-tight": {
    regular: "InterTight-Regular",
    medium: "InterTight-SemiBold",
    bold: "InterTight-Bold",
  },
  "mona-sans": { regular: "MonaSans-Regular", medium: "MonaSans-SemiBold", bold: "MonaSans-Bold" },
};
const MONO = "monospace";

type Weight = "regular" | "medium" | "bold";

function useCardTheme(app: AppBrandId) {
  return appCardTheme(app, useColorScheme() === "dark" ? "dark" : "light");
}

/** Text in the card's app font and colour. */
function T({
  theme,
  weight = "regular",
  size = 14,
  color,
  style,
  lines,
  children,
}: {
  theme: AppCardTheme;
  weight?: Weight;
  size?: number;
  color?: string;
  style?: TextStyle;
  lines?: number;
  children: ReactNode;
}) {
  return (
    <Text
      numberOfLines={lines}
      style={[
        {
          fontFamily: FONTS[theme.font][weight],
          fontSize: size,
          lineHeight: Math.round(size * 1.35),
          color: color ?? theme.onSurface,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

const ENTER = FadeInDown.duration(260).reduceMotion(ReduceMotion.System);

function AppCard({
  theme,
  label,
  children,
}: {
  theme: AppCardTheme;
  label: string;
  children: ReactNode;
}) {
  return (
    <Animated.View
      entering={ENTER}
      accessibilityLabel={label}
      style={{
        overflow: "hidden",
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: theme.outline,
        backgroundColor: theme.surface,
      }}
    >
      {children}
    </Animated.View>
  );
}

// The brand's monogram tile; T3 Code bundles no logos (docs/user/openui-reports.md).
function BrandTile({ brand }: { brand: AppBrand }) {
  return (
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: 6,
        backgroundColor: brand.color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: brand.onColor,
          fontSize: brand.mark.length > 1 ? 10 : 13,
          fontWeight: "700",
        }}
      >
        {brand.mark}
      </Text>
    </View>
  );
}

function Octicon({ icon, color, size = 16 }: { icon: OcticonName; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      {OCTICONS[icon].map((d) => (
        <Path key={d} d={d} fill={color} />
      ))}
    </Svg>
  );
}

function PillButton({
  theme,
  label,
  url,
  tone,
}: {
  theme: AppCardTheme;
  label: string;
  url: string;
  tone: "primary" | "container" | "outline";
}) {
  const fill =
    tone === "primary" ? theme.primary : tone === "container" ? theme.container : theme.surfaceAlt;
  const ink =
    tone === "primary"
      ? theme.onPrimary
      : tone === "container"
        ? theme.onContainer
        : theme.onSurface;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => void Linking.openURL(url)}
      style={({ pressed }) => ({
        height: 34,
        paddingHorizontal: 14,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: fill,
        borderWidth: tone === "outline" ? 1 : 0,
        borderColor: theme.outline,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <T theme={theme} weight="medium" size={13} color={ink}>
        {label}
      </T>
    </Pressable>
  );
}

function Footer({ theme, children }: { theme: AppCardTheme; children: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: theme.outline,
      }}
    >
      {children}
    </View>
  );
}

const CARS: Record<CarClass, number> = {
  x: require("../../assets/app-cards/car-x.webp"),
  comfort: require("../../assets/app-cards/car-comfort.webp"),
  xl: require("../../assets/app-cards/car-xl.webp"),
  black: require("../../assets/app-cards/car-black.webp"),
};
const RIDE_LINKS = { uber: "https://m.uber.com/", lyft: "https://ride.lyft.com/" } as const;

/** Uber's product picker: vehicle renders, a grey selected row with a black outline, one black button. */
const RideOptionsCard = memo(function RideOptionsCard({
  props,
}: {
  props: z.infer<typeof rideOptionsProps>;
}) {
  const brand = APP_BRANDS[props.app];
  const theme = useCardTheme(props.app);
  const best = cheapestRide(props.options);
  const [selected, setSelected] = useState(() =>
    Math.max(
      0,
      props.options.findIndex((option) => option.name === best),
    ),
  );
  const chosen = props.options[selected] ?? props.options[0]!;
  return (
    <AppCard
      theme={theme}
      label={`${brand.name} ride options from ${props.pickup} to ${props.dropoff}`}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          padding: 14,
          paddingBottom: 8,
        }}
      >
        <BrandTile brand={brand} />
        <View style={{ flex: 1 }}>
          <T theme={theme} weight="bold" size={17} lines={1} style={{ letterSpacing: -0.3 }}>
            {`Ride to ${props.dropoff}`}
          </T>
          <T theme={theme} size={12} color={theme.muted} lines={1}>
            {`from ${props.pickup}`}
          </T>
        </View>
      </View>
      <View style={{ paddingHorizontal: 8 }}>
        {props.options.map((option, index) => {
          const active = selected === index;
          return (
            <Pressable
              key={option.name}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={rideReadout(option)}
              onPress={() => setSelected(index)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                height: 64,
                paddingRight: 12,
                borderRadius: 12,
                borderWidth: 2,
                borderColor: active ? theme.onSurface : "transparent",
                backgroundColor: active ? theme.surfaceAlt : "transparent",
              }}
            >
              <Image
                source={CARS[carClass(option.name)]}
                style={{ width: 72, height: 44 }}
                contentFit="contain"
              />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <T theme={theme} weight="medium" size={16} lines={1} style={{ flexShrink: 1 }}>
                    {option.name}
                  </T>
                  <T theme={theme} weight="medium" size={12}>{`👤 ${option.seats}`}</T>
                  {option.name === best ? (
                    <T theme={theme} weight="medium" size={11} color={theme.success}>
                      Cheapest
                    </T>
                  ) : null}
                </View>
                <T theme={theme} size={13} color={theme.muted} lines={1}>
                  {`${option.arrival ? `${option.arrival} · ` : ""}${option.minutes} min away`}
                </T>
              </View>
              <T theme={theme} weight="medium" size={16}>
                {option.price}
              </T>
            </Pressable>
          );
        })}
      </View>
      <View style={{ padding: 14, paddingTop: 8, gap: 8 }}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Choose ${chosen.name}`}
          onPress={() => void Linking.openURL(RIDE_LINKS[props.app])}
          style={({ pressed }) => ({
            height: 48,
            borderRadius: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.primary,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <T theme={theme} weight="medium" size={16} color={theme.onPrimary}>
            {`Choose ${chosen.name}`}
          </T>
        </Pressable>
        <T theme={theme} size={12} color={theme.muted} style={{ textAlign: "center" }}>
          {`Opens ${brand.name} to confirm. Nothing is booked from here.`}
        </T>
      </View>
    </AppCard>
  );
});

/** Gmail's list: avatars, bold unread rows, read rows on the tinted surface, attachment chips. */
const MailListCard = memo(function MailListCard({
  props,
}: {
  props: z.infer<typeof mailListProps>;
}) {
  const brand = APP_BRANDS.gmail;
  const theme = useCardTheme("gmail");
  const [open, setOpen] = useState<number | null>(null);
  return (
    <AppCard theme={theme} label={`Gmail results for ${props.query}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}>
        <BrandTile brand={brand} />
        <View
          style={{
            flex: 1,
            height: 40,
            borderRadius: 999,
            paddingHorizontal: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            backgroundColor: theme.surfaceAlt,
          }}
        >
          <T theme={theme} size={14} lines={1} style={{ flex: 1 }}>
            {props.query}
          </T>
          <T theme={theme} size={12} color={theme.muted}>
            {`${props.messages.length} result${props.messages.length === 1 ? "" : "s"}`}
          </T>
        </View>
      </View>
      {props.messages.length === 0 ? (
        <T
          theme={theme}
          size={14}
          color={theme.muted}
          style={{ paddingHorizontal: 16, paddingBottom: 12 }}
        >
          No messages matched.
        </T>
      ) : null}
      {props.messages.map((message, index) => {
        const isOpen = open === index;
        const weight = message.unread ? "bold" : "regular";
        const ink = isOpen ? theme.onContainer : theme.onSurface;
        return (
          <Pressable
            key={`${message.from}\u0000${message.subject}\u0000${message.time}`}
            accessibilityRole="button"
            accessibilityState={{ expanded: isOpen }}
            accessibilityLabel={`${message.unread ? "Unread, " : ""}${message.from}: ${message.subject}, ${message.time}`}
            onPress={() => setOpen(isOpen ? null : index)}
            style={{
              flexDirection: "row",
              gap: 12,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderTopWidth: 1,
              borderTopColor: theme.outline,
              backgroundColor: isOpen
                ? theme.container
                : message.unread
                  ? theme.surface
                  : theme.surfaceAlt,
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: avatarColor(message.from),
              }}
            >
              <Text style={{ color: "#ffffff", fontSize: 14, fontWeight: "500" }}>
                {message.from.trim().charAt(0).toUpperCase() || "?"}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <T
                  theme={theme}
                  weight={weight}
                  size={14}
                  color={ink}
                  lines={1}
                  style={{ flex: 1 }}
                >
                  {message.from}
                </T>
                <T theme={theme} weight={weight} size={12} color={ink}>
                  {message.time}
                </T>
              </View>
              <T theme={theme} weight={weight} size={14} color={ink} lines={1}>
                {message.subject}
              </T>
              <T
                theme={theme}
                size={13}
                color={isOpen ? ink : theme.muted}
                lines={isOpen ? undefined : 1}
              >
                {message.snippet}
              </T>
              {message.attachment ? (
                <View
                  style={{
                    alignSelf: "flex-start",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 6,
                    height: 32,
                    paddingLeft: 8,
                    paddingRight: 12,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: theme.outline,
                    backgroundColor: theme.surface,
                  }}
                >
                  <Text
                    style={{
                      color: "#ffffff",
                      backgroundColor: brand.color,
                      fontSize: 8,
                      fontWeight: "700",
                      paddingHorizontal: 4,
                      borderRadius: 2,
                    }}
                  >
                    {message.attachment.split(".").pop()?.toUpperCase().slice(0, 4) ?? "FILE"}
                  </Text>
                  <T theme={theme} size={13} lines={1}>
                    {message.attachment}
                  </T>
                </View>
              ) : null}
            </View>
          </Pressable>
        );
      })}
      <Footer theme={theme}>
        <PillButton
          theme={theme}
          label="Open in Gmail"
          tone="container"
          url={`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(props.query)}`}
        />
      </Footer>
    </AppCard>
  );
});

const MODE_LABEL = {
  drive: "Driving",
  walk: "Walking",
  transit: "Transit",
  bike: "Cycling",
} as const;
const MAPS_MODE = {
  drive: "driving",
  walk: "walking",
  transit: "transit",
  bike: "bicycling",
} as const;
const MAP_W = 400;
const MAP_H = 200;

/** The tool's route over the tool's basemap, in Google's map colours. Only real geometry. */
function RouteMap({
  path,
  map,
  scheme,
}: {
  path: ReadonlyArray<readonly [number, number]>;
  map: z.infer<typeof routeProps>["map"];
  scheme: "light" | "dark";
}) {
  const paint = MAP_PAINT[scheme];
  const { points, d } = projectPath(path, MAP_W, MAP_H, 22, map?.bounds);
  const start = points[0]!;
  const end = points.at(-1)!;
  return (
    <View style={{ aspectRatio: MAP_W / MAP_H, backgroundColor: paint.land }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${MAP_W} ${MAP_H}`}>
        {map ? (
          <SvgImage
            href={{ uri: map.image }}
            width={MAP_W}
            height={MAP_H}
            preserveAspectRatio="none"
          />
        ) : null}
        {/* Basemaps come light; dark mode dims them under Google's night land colour. */}
        {map && scheme === "dark" ? (
          <Rect width={MAP_W} height={MAP_H} fill={paint.land} opacity={0.6} />
        ) : null}
        <Path
          d={d}
          fill="none"
          stroke={paint.routeCasing}
          strokeWidth={7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d={d}
          fill="none"
          stroke={paint.route}
          strokeWidth={4.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle
          cx={start[0]}
          cy={start[1]}
          r={5.5}
          fill={paint.startFill}
          stroke={paint.ink}
          strokeWidth={2.5}
        />
        <G x={end[0]} y={end[1]}>
          <Path d="M0 0c-7-9-10-13-10-18a10 10 0 0 1 20 0c0 5-3 9-10 18z" fill={paint.pin} />
          <Circle cy={-18} r={3.6} fill={paint.pinCore} />
        </G>
      </Svg>
    </View>
  );
}

/** Google Maps' directions panel: travel time in traffic green, the route, then one step at a time. */
const RouteCard = memo(function RouteCard({ props }: { props: z.infer<typeof routeProps> }) {
  const brand = APP_BRANDS["google-maps"];
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = appCardTheme("google-maps", scheme);
  const [step, setStep] = useState(0);
  const total = props.steps.length;
  const query = `origin=${encodeURIComponent(props.origin)}&destination=${encodeURIComponent(props.destination)}&travelmode=${MAPS_MODE[props.mode]}`;
  return (
    <AppCard theme={theme} label={`Directions from ${props.origin} to ${props.destination}`}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 14,
          paddingTop: 14,
        }}
      >
        <BrandTile brand={brand} />
        <T theme={theme} weight="medium" size={14} lines={1} style={{ flex: 1 }}>
          {`${props.origin} → ${props.destination}`}
        </T>
      </View>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          columnGap: 12,
          rowGap: 4,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <View
          style={{
            height: 32,
            paddingHorizontal: 12,
            borderRadius: 999,
            justifyContent: "center",
            backgroundColor: theme.container,
          }}
        >
          <T theme={theme} weight="medium" size={13} color={theme.onContainer}>
            {MODE_LABEL[props.mode]}
          </T>
        </View>
        <T
          theme={theme}
          weight="medium"
          size={20}
          color={theme.success}
        >{`${props.minutes} min`}</T>
        <T theme={theme} size={14} color={theme.muted} lines={1}>
          {`${props.distance}${props.via ? ` · via ${props.via}` : ""}`}
        </T>
      </View>
      {props.path ? <RouteMap path={props.path} map={props.map} scheme={scheme} /> : null}
      {total ? (
        <View
          style={{
            margin: 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            padding: 10,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.outline,
            backgroundColor: theme.surfaceAlt,
          }}
        >
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme.primary,
            }}
          >
            <T theme={theme} weight="medium" size={12} color={theme.onPrimary}>
              {step + 1}
            </T>
          </View>
          <T theme={theme} size={14} style={{ flex: 1 }}>
            {props.steps[step]}
          </T>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous step"
            disabled={step === 0}
            onPress={() => setStep(step - 1)}
            hitSlop={6}
            style={{ opacity: step === 0 ? 0.35 : 1, padding: 4 }}
          >
            <T theme={theme} size={18} color={theme.muted}>
              ‹
            </T>
          </Pressable>
          <T theme={theme} size={12} color={theme.muted}>{`${step + 1} / ${total}`}</T>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next step"
            disabled={step === total - 1}
            onPress={() => setStep(step + 1)}
            hitSlop={6}
            style={{ opacity: step === total - 1 ? 0.35 : 1, padding: 4 }}
          >
            <T theme={theme} size={18} color={theme.muted}>
              ›
            </T>
          </Pressable>
        </View>
      ) : null}
      <Footer theme={theme}>
        <PillButton
          theme={theme}
          label="Open in Maps"
          tone="container"
          url={`https://www.google.com/maps/dir/?api=1&${query}`}
        />
        <PillButton
          theme={theme}
          label="Start"
          tone="primary"
          url={`https://www.google.com/maps/dir/?api=1&${query}&dir_action=navigate`}
        />
      </Footer>
    </AppCard>
  );
});

const STATE = {
  open: { label: "Open", icon: "git-pull-request" },
  conflict: { label: "Open", icon: "git-pull-request" },
  ready: { label: "Open", icon: "git-pull-request" },
  merged: { label: "Merged", icon: "git-merge" },
  closed: { label: "Closed", icon: "git-pull-request-closed" },
} as const satisfies Record<string, { label: string; icon: OcticonName }>;
const STATUS_ICON = {
  pass: "check-circle-fill",
  fail: "x-circle-fill",
  running: "dot-fill",
  skip: "skip",
} as const satisfies Record<string, OcticonName>;
const ROW = 34;

function statusTone(theme: AppCardTheme, status: "pass" | "fail" | "running" | "skip") {
  return status === "pass"
    ? theme.success
    : status === "fail"
      ? theme.danger
      : status === "running"
        ? theme.warning
        : theme.muted;
}

function CommitGraph({
  theme,
  commits,
}: {
  theme: AppCardTheme;
  commits: NonNullable<z.infer<typeof pullRequestProps>["commits"]>;
}) {
  const laneColor = { base: theme.muted, head: theme.accent, side: theme.success } as const;
  const height = commits.length * ROW;
  const ys = commits.map((_, index) => index * ROW + ROW / 2);
  const lanes = commits.map((commit) => commit.lane);
  const baseLast = lanes.lastIndexOf("base");
  const paths: ReactNode[] = [];
  for (const lane of ["base", "head", "side"] as const) {
    const first = lanes.indexOf(lane);
    const last = lanes.lastIndexOf(lane);
    if (first < 0) continue;
    const x = commitLaneX(lane);
    paths.push(
      <Path
        key={`${lane}-line`}
        d={`M${x} ${ys[first]} V${ys[last]}`}
        stroke={laneColor[lane]}
        strokeOpacity={0.6}
        strokeWidth={2}
      />,
    );
    if (lane !== "base" && baseLast > last) {
      const y1 = ys[last]!;
      const y2 = ys[baseLast]!;
      const bx = commitLaneX("base");
      paths.push(
        <Path
          key={`${lane}-fork`}
          d={`M${x} ${y1} C${x} ${(y1 + y2) / 2} ${bx} ${(y1 + y2) / 2} ${bx} ${y2}`}
          stroke={laneColor[lane]}
          strokeOpacity={0.6}
          strokeWidth={2}
          fill="none"
        />,
      );
    }
  }
  return (
    <Svg
      width={56}
      height={height}
      style={{ position: "absolute", left: 0, top: 0 }}
      pointerEvents="none"
    >
      {paths}
      {commits.map((commit, index) => (
        <Circle
          key={commit.sha}
          cx={commitLaneX(commit.lane)}
          cy={ys[index]}
          r={4.5}
          fill={commit.conflict ? theme.warning : theme.surface}
          stroke={commit.conflict ? theme.warning : laneColor[commit.lane]}
          strokeWidth={2}
        />
      ))}
    </Svg>
  );
}

/** GitHub's pull request in Primer: state label, commit graph, checks as a timeline, merge box line. */
const PullRequestCard = memo(function PullRequestCard({
  props,
}: {
  props: z.infer<typeof pullRequestProps>;
}) {
  const brand = APP_BRANDS.github;
  const theme = useCardTheme("github");
  const state = STATE[props.state];
  const stateTone =
    props.state === "merged" ? theme.done : props.state === "closed" ? theme.danger : theme.success;
  const counts = checkCounts(props.checks);
  const timeline = checkTimeline(props.checks);
  const [open, setOpen] = useState<number | null>(() => {
    const failed = props.checks.findIndex((check) => check.status === "fail" && check.detail);
    return failed < 0 ? null : failed;
  });
  const commits = props.commits ?? [];
  const plural = props.conflicts === 1 ? "" : "s";
  const foot =
    props.state === "conflict"
      ? {
          icon: "alert",
          tone: theme.warning,
          title: `This branch has ${props.conflicts} conflict${plural} that must be resolved`,
          sub: `Conflicts with ${props.base}`,
        }
      : props.state === "ready"
        ? {
            icon: "check",
            tone: theme.success,
            title: "All checks have passed",
            sub: "No conflicts with the base branch",
          }
        : props.state === "merged"
          ? {
              icon: "git-merge",
              tone: theme.done,
              title: "Pull request successfully merged and closed",
              sub: `Merged into ${props.base}`,
            }
          : props.state === "closed"
            ? {
                icon: "git-pull-request-closed",
                tone: theme.danger,
                title: "Closed with unmerged commits",
                sub: `${props.head} was not merged`,
              }
            : counts.fail
              ? {
                  icon: "x-circle-fill",
                  tone: theme.danger,
                  title: "Some checks were not successful",
                  sub: `${counts.fail} failing, ${counts.pass} successful`,
                }
              : {
                  icon: "dot-fill",
                  tone: theme.warning,
                  title: "Some checks haven't completed yet",
                  sub: `${counts.running} in progress, ${counts.pass} successful`,
                };
  const chip = (label: string) => (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 11,
        color: theme.onContainer,
        backgroundColor: theme.container,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        overflow: "hidden",
      }}
      numberOfLines={1}
    >
      {label}
    </Text>
  );
  return (
    <AppCard theme={theme} label={`Pull request ${props.number}, ${props.state}`}>
      <View style={{ flexDirection: "row", gap: 10, padding: 14, paddingBottom: 10 }}>
        <BrandTile brand={brand} />
        <View style={{ flex: 1, gap: 6 }}>
          <T theme={theme} weight="medium" size={15}>
            {props.title}
            <T theme={theme} size={15} color={theme.muted}>{` #${props.number}`}</T>
          </T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 999,
                backgroundColor: stateTone,
              }}
            >
              <Octicon icon={state.icon} color="#ffffff" size={14} />
              <T theme={theme} weight="medium" size={12} color="#ffffff">
                {state.label}
              </T>
            </View>
            {chip(props.head)}
            <T theme={theme} size={12} color={theme.muted}>
              →
            </T>
            {chip(props.base)}
          </View>
        </View>
      </View>
      {commits.length ? (
        <View style={{ borderTopWidth: 1, borderTopColor: theme.outline }}>
          {commits.map((commit) => (
            <View
              key={commit.sha}
              style={{
                height: ROW,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingLeft: 56,
                paddingRight: 14,
                backgroundColor: commit.conflict ? theme.warningSurface : undefined,
              }}
            >
              <T
                theme={theme}
                size={13}
                lines={1}
                color={commit.lane === "head" ? theme.onSurface : theme.muted}
                style={{ flex: 1 }}
              >
                {commit.title}
              </T>
              <Text style={{ fontFamily: MONO, fontSize: 11, color: theme.muted }}>
                {commit.sha.slice(0, 7)}
              </Text>
            </View>
          ))}
          <CommitGraph theme={theme} commits={commits} />
        </View>
      ) : null}
      {props.checks.length ? (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: theme.outline,
            backgroundColor: theme.surfaceAlt,
            paddingVertical: 6,
          }}
        >
          {props.checks.map((check, index) => {
            const tone = statusTone(theme, check.status);
            const span = timeline?.spans[index];
            return (
              <View key={`${check.name}\u0000${check.status}`}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${check.name}: ${check.status}`}
                  accessibilityState={{ expanded: open === index, disabled: !check.detail }}
                  disabled={!check.detail}
                  onPress={() => setOpen(open === index ? null : index)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingHorizontal: 14,
                    paddingVertical: 6,
                  }}
                >
                  <Octicon icon={STATUS_ICON[check.status]} color={tone} />
                  <T theme={theme} weight="medium" size={13} lines={1} style={{ width: 96 }}>
                    {check.name}
                  </T>
                  <View style={{ flex: 1, height: 6 }}>
                    {span ? (
                      <View
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: `${span.start * 100}%`,
                          width: `${Math.max(span.length * 100, 2)}%`,
                          borderRadius: 3,
                          backgroundColor: tone,
                        }}
                      />
                    ) : null}
                  </View>
                  <T
                    theme={theme}
                    size={12}
                    color={check.status === "fail" ? theme.danger : theme.muted}
                    style={{ width: 44, textAlign: "right" }}
                  >
                    {check.seconds !== undefined ? formatSeconds(check.seconds) : ""}
                  </T>
                </Pressable>
                {check.detail && open === index ? (
                  <Text
                    style={{
                      fontFamily: MONO,
                      fontSize: 12,
                      marginHorizontal: 14,
                      marginBottom: 6,
                      padding: 8,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: theme.outline,
                      backgroundColor: theme.surface,
                      color: check.status === "fail" ? theme.danger : theme.muted,
                    }}
                  >
                    {check.detail}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          padding: 14,
          borderTopWidth: 1,
          borderTopColor: theme.outline,
        }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: foot.tone,
          }}
        >
          <Octicon icon={foot.icon as OcticonName} color="#ffffff" />
        </View>
        <View style={{ flex: 1 }}>
          <T theme={theme} weight="medium" size={13} lines={2}>
            {foot.title}
          </T>
          <T theme={theme} size={12} color={theme.muted} lines={1}>
            {foot.sub}
          </T>
        </View>
        <PillButton
          theme={theme}
          label="Open on GitHub"
          tone="outline"
          url="https://github.com/pulls"
        />
      </View>
    </AppCard>
  );
});

export const RideOptions = defineComponent({
  name: "RideOptions",
  description: DESCRIPTIONS.RideOptions,
  props: rideOptionsProps,
  component: RideOptionsCard,
});
export const MailList = defineComponent({
  name: "MailList",
  description: DESCRIPTIONS.MailList,
  props: mailListProps,
  component: MailListCard,
});
export const Route = defineComponent({
  name: "Route",
  description: DESCRIPTIONS.Route,
  props: routeProps,
  component: RouteCard,
});
export const PullRequest = defineComponent({
  name: "PullRequest",
  description: DESCRIPTIONS.PullRequest,
  props: pullRequestProps,
  component: PullRequestCard,
});

export const appCardSchemas = {
  RideOptions: (value: unknown) => rideOptionsProps.safeParse(value),
  MailList: (value: unknown) => mailListProps.safeParse(value),
  Route: (value: unknown) => routeProps.safeParse(value),
  PullRequest: (value: unknown) => pullRequestProps.safeParse(value),
};
