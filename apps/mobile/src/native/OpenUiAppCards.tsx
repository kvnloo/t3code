import { defineComponent } from "@openuidev/react-lang";
import { memo, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated, { ReduceMotion, ZoomIn, withDelay, withTiming } from "react-native-reanimated";
import { z } from "zod/v4";

import { APP_BRANDS, type AppBrand } from "@t3tools/client-runtime/app-connectors";
import {
  APP_CARD_DESCRIPTIONS as DESCRIPTIONS,
  APP_CARD_LIMITS as LIMITS,
  CHECK_STATUS_SYMBOL,
  PULL_REQUEST_STATE_COLORS,
  cheapestRide,
  checkCounts,
  pullRequestSteps,
  rideReadout,
} from "@t3tools/client-runtime/openui-app-cards";

import { AppText } from "../components/ui/AppText";

const text = z.string().max(LIMITS.text);
const name = z.string().min(1).max(LIMITS.text);
const minutes = z.number().finite().min(0).max(LIMITS.minutes);

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
});
export const pullRequestProps = z.object({
  number: z.number().int().min(1),
  title: name,
  state: z.enum(["open", "conflict", "ready", "merged", "closed"]),
  head: name,
  base: name,
  checks: z
    .array(z.object({ name, status: z.enum(["pass", "fail", "running", "skip"]), detail: text }))
    .max(LIMITS.checks),
  conflicts: z.number().int().min(0).max(10_000),
  // Accepted for parity with web, which draws the commit graph; this card shows checks only.
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

/** Brand header shared by every card: monogram, service name, one line of context. */
function CardShell({
  brand,
  subtitle,
  accessibilityLabel,
  children,
}: {
  brand: AppBrand;
  subtitle: string;
  accessibilityLabel: string;
  children: ReactNode;
}) {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <View style={{ height: 3, backgroundColor: brand.color }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}>
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            backgroundColor: brand.color,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AppText
            style={{
              color: brand.onColor,
              fontSize: brand.mark.length > 1 ? 11 : 15,
              fontWeight: "700",
            }}
          >
            {brand.mark}
          </AppText>
        </View>
        <View style={{ flex: 1 }}>
          <AppText className="text-sm font-semibold">{brand.name}</AppText>
          <AppText numberOfLines={1} className="text-xs text-foreground-muted">
            {subtitle}
          </AppText>
        </View>
      </View>
      <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}>{children}</View>
    </View>
  );
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <View
      style={{
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
        backgroundColor: `${color}22`,
      }}
    >
      <AppText style={{ color, fontSize: 11, fontWeight: "600" }}>{label}</AppText>
    </View>
  );
}

const RideOptionsCard = memo(function RideOptionsCard({
  props,
}: {
  props: z.infer<typeof rideOptionsProps>;
}) {
  const brand = APP_BRANDS[props.app];
  const [selected, setSelected] = useState<number | null>(null);
  const best = cheapestRide(props.options);
  return (
    <CardShell
      brand={brand}
      subtitle={`${props.pickup} → ${props.dropoff}`}
      accessibilityLabel={`${brand.name} ride options from ${props.pickup} to ${props.dropoff}`}
    >
      {props.options.map((option, index) => {
        const active = selected === index;
        return (
          <Pressable
            key={option.name}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={rideReadout(option)}
            onPress={() => setSelected(index)}
            className={active ? "rounded-lg bg-subtle" : "rounded-lg"}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              padding: 10,
              borderWidth: active ? 2 : 1,
              borderColor: active
                ? brand.color === "#000000"
                  ? "#888888"
                  : brand.color
                : "rgba(127,127,127,0.25)",
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <AppText className="text-sm font-semibold">{option.name}</AppText>
                {option.name === best ? <Tag label="Best price" color="#1A7F37" /> : null}
              </View>
              <AppText className="text-xs text-foreground-muted">{`${option.minutes} min away · ${option.seats} seats${option.arrival ? ` · ${option.arrival}` : ""}`}</AppText>
            </View>
            <AppText className="text-base font-semibold">{option.price}</AppText>
          </Pressable>
        );
      })}
      <AppText className="text-xs text-foreground-muted">
        {selected === null
          ? `Prices from ${brand.name}. Booking happens in the ${brand.name} app.`
          : rideReadout(props.options[selected]!)}
      </AppText>
    </CardShell>
  );
});

const MailListCard = memo(function MailListCard({
  props,
}: {
  props: z.infer<typeof mailListProps>;
}) {
  const brand = APP_BRANDS.gmail;
  const [open, setOpen] = useState<number | null>(null);
  const unread = props.messages.filter((message) => message.unread).length;
  return (
    <CardShell
      brand={brand}
      subtitle={`“${props.query}” · ${props.messages.length} results${unread ? ` · ${unread} unread` : ""}`}
      accessibilityLabel={`Gmail results for ${props.query}`}
    >
      {props.messages.length === 0 ? (
        <AppText className="text-sm text-foreground-muted">No messages matched.</AppText>
      ) : null}
      {props.messages.map((message, index) => (
        <Pressable
          key={`${message.from}\u0000${message.subject}\u0000${message.time}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: open === index }}
          accessibilityLabel={`${message.unread ? "Unread, " : ""}${message.from}: ${message.subject}, ${message.time}`}
          onPress={() => setOpen(open === index ? null : index)}
          style={{ flexDirection: "row", gap: 8, paddingVertical: 6 }}
        >
          <View style={{ width: 8, paddingTop: 6 }}>
            {message.unread ? (
              <View
                style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: brand.color }}
              />
            ) : null}
          </View>
          <View style={{ flex: 1, gap: 1 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <AppText
                numberOfLines={1}
                className={message.unread ? "flex-1 text-sm font-semibold" : "flex-1 text-sm"}
              >
                {message.from}
              </AppText>
              <AppText className="text-xs text-foreground-muted">{message.time}</AppText>
            </View>
            <AppText
              numberOfLines={1}
              className={message.unread ? "text-sm font-semibold" : "text-sm"}
            >
              {message.subject}
            </AppText>
            <AppText
              numberOfLines={open === index ? undefined : 1}
              className="text-xs text-foreground-muted"
            >
              {message.snippet}
            </AppText>
            {message.attachment ? (
              <AppText numberOfLines={1} className="text-xs text-foreground-muted">
                {`📎 ${message.attachment}`}
              </AppText>
            ) : null}
          </View>
        </Pressable>
      ))}
    </CardShell>
  );
});

const MODE_LABEL = {
  drive: "Driving",
  walk: "Walking",
  transit: "Transit",
  bike: "Cycling",
} as const;

const RouteCard = memo(function RouteCard({ props }: { props: z.infer<typeof routeProps> }) {
  const brand = APP_BRANDS["google-maps"];
  const [step, setStep] = useState<number | null>(null);
  return (
    <CardShell
      brand={brand}
      subtitle={`${MODE_LABEL[props.mode]} · ${props.origin} → ${props.destination}`}
      accessibilityLabel={`Directions from ${props.origin} to ${props.destination}`}
    >
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <AppText
          style={{ color: brand.color, fontSize: 26, fontWeight: "700" }}
        >{`${props.minutes} min`}</AppText>
        <AppText className="text-sm text-foreground-muted">{props.distance}</AppText>
      </View>
      {props.steps.map((entry, index) => (
        <Pressable
          key={`${index + 1}. ${entry}`}
          accessibilityRole="button"
          accessibilityState={{ selected: step === index }}
          onPress={() => setStep(index)}
          style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}
        >
          <View style={{ alignItems: "center", width: 18 }}>
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 9,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: step === index ? brand.color : `${brand.color}22`,
              }}
            >
              <AppText
                style={{
                  fontSize: 10,
                  fontWeight: "700",
                  color: step === index ? brand.onColor : brand.color,
                }}
              >
                {index + 1}
              </AppText>
            </View>
            {index < props.steps.length - 1 ? (
              <View style={{ width: 2, height: 14, backgroundColor: `${brand.color}55` }} />
            ) : null}
          </View>
          <AppText className={step === index ? "flex-1 text-sm font-semibold" : "flex-1 text-sm"}>
            {entry}
          </AppText>
        </Pressable>
      ))}
    </CardShell>
  );
});

/** The last step of a merged track grows in once when the card mounts; reduced motion skips it. */
function finishMerge() {
  "worklet";
  return {
    initialValues: { transform: [{ scaleX: 0.75 }] },
    animations: {
      transform: [
        {
          scaleX: withDelay(
            150,
            withTiming(1, { duration: 650, reduceMotion: ReduceMotion.System }),
          ),
        },
      ],
    },
  };
}

function StepTrack({
  fraction,
  color,
  animate,
}: {
  fraction: number;
  color: string;
  animate: boolean;
}) {
  return (
    <View
      style={{
        height: 4,
        borderRadius: 2,
        backgroundColor: "rgba(127,127,127,0.22)",
        overflow: "hidden",
      }}
    >
      <Animated.View
        entering={animate ? finishMerge : undefined}
        style={{
          height: 4,
          width: `${fraction * 100}%`,
          borderRadius: 2,
          backgroundColor: color,
          transformOrigin: "left",
        }}
      />
    </View>
  );
}

const MERGED_PILL_ENTERING = ZoomIn.delay(700).duration(220).reduceMotion(ReduceMotion.System);

function MergedPill({ color, animate }: { color: string; animate: boolean }) {
  return (
    <Animated.View
      entering={animate ? MERGED_PILL_ENTERING : undefined}
      style={{
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 3,
        backgroundColor: color,
      }}
    >
      <AppText style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "700" }}>Merged</AppText>
    </Animated.View>
  );
}

const STATE_LABEL = {
  open: "Open",
  conflict: "Conflicts",
  ready: "Ready to merge",
  merged: "Merged",
  closed: "Closed",
} as const;

const PullRequestCard = memo(function PullRequestCard({
  props,
}: {
  props: z.infer<typeof pullRequestProps>;
}) {
  const brand = APP_BRANDS.github;
  const stateColor = PULL_REQUEST_STATE_COLORS[props.state];
  const steps = pullRequestSteps(props.state);
  const reached = steps.filter((entry) => entry.reached).length;
  const counts = checkCounts(props.checks);
  const [check, setCheck] = useState<number | null>(null);
  const merged = props.state === "merged";
  return (
    <CardShell
      brand={brand}
      subtitle={`#${props.number} · ${props.head} → ${props.base}`}
      accessibilityLabel={`Pull request ${props.number}, ${STATE_LABEL[props.state]}`}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <AppText numberOfLines={2} className="flex-1 text-sm font-semibold">
          {props.title}
        </AppText>
        {merged ? (
          <MergedPill color={stateColor} animate />
        ) : (
          <Tag label={STATE_LABEL[props.state]} color={stateColor} />
        )}
      </View>
      <StepTrack fraction={reached / steps.length} color={stateColor} animate={merged} />
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        {steps.map((entry) => (
          <AppText
            key={entry.name}
            className={entry.reached ? "text-2xs font-semibold" : "text-2xs text-foreground-muted"}
          >
            {entry.name}
          </AppText>
        ))}
      </View>
      {props.state === "conflict" ? (
        <AppText
          style={{ color: stateColor }}
          className="text-xs font-semibold"
        >{`${props.conflicts} conflict${props.conflicts === 1 ? "" : "s"} with ${props.base}`}</AppText>
      ) : null}
      {props.checks.length ? (
        <View style={{ gap: 4 }}>
          <AppText className="text-xs text-foreground-muted">{`Checks · ${counts.pass} passed${counts.fail ? ` · ${counts.fail} failed` : ""}${counts.running ? ` · ${counts.running} running` : ""}${counts.skip ? ` · ${counts.skip} skipped` : ""}`}</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {props.checks.map((entry, index) => {
              const color =
                entry.status === "pass"
                  ? "#1A7F37"
                  : entry.status === "fail"
                    ? "#CF222E"
                    : entry.status === "running"
                      ? "#9A6700"
                      : "#6E7781";
              return (
                <Pressable
                  key={`${entry.name}\u0000${entry.status}\u0000${entry.detail}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${entry.name}: ${entry.status}${entry.detail ? `, ${entry.detail}` : ""}`}
                  onPress={() => setCheck(check === index ? null : index)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    borderRadius: 999,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderWidth: 1,
                    borderColor: check === index ? color : "rgba(127,127,127,0.3)",
                  }}
                >
                  <AppText style={{ color, fontSize: 11, fontWeight: "700" }}>
                    {CHECK_STATUS_SYMBOL[entry.status]}
                  </AppText>
                  <AppText className="text-xs">{entry.name}</AppText>
                </Pressable>
              );
            })}
          </View>
          {check !== null && props.checks[check]?.detail ? (
            <AppText className="text-xs text-foreground-muted">{`${props.checks[check]!.name}: ${props.checks[check]!.detail}`}</AppText>
          ) : null}
        </View>
      ) : null}
    </CardShell>
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
