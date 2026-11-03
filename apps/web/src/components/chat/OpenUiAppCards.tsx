import "@fontsource-variable/google-sans";
import "@fontsource-variable/inter-tight";
import "@fontsource-variable/mona-sans";

import { defineComponent } from "@openuidev/react-lang";
import { memo, useState, type CSSProperties, type ReactNode } from "react";
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

import carBlack from "~/assets/app-cards/car-black.webp";
import carComfort from "~/assets/app-cards/car-comfort.webp";
import carX from "~/assets/app-cards/car-x.webp";
import carXl from "~/assets/app-cards/car-xl.webp";
import { useRenderedAppearance } from "~/hooks/useTheme";

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

const FONT_STACK: Record<AppCardFont, string> = {
  "google-sans": '"Google Sans Variable", "Google Sans", Roboto, Arial, sans-serif',
  "inter-tight": '"Inter Tight Variable", "Inter Variable", "Helvetica Neue", Arial, sans-serif',
  "mona-sans":
    '"Mona Sans Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif',
};
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

/** Theme tokens as CSS variables, so every element below reads var(--ac-…). */
function themeVars(theme: AppCardTheme): CSSProperties {
  return {
    "--ac-surface": theme.surface,
    "--ac-surface-alt": theme.surfaceAlt,
    "--ac-on-surface": theme.onSurface,
    "--ac-muted": theme.muted,
    "--ac-outline": theme.outline,
    "--ac-primary": theme.primary,
    "--ac-on-primary": theme.onPrimary,
    "--ac-container": theme.container,
    "--ac-on-container": theme.onContainer,
    "--ac-accent": theme.accent,
    "--ac-success": theme.success,
    "--ac-warning": theme.warning,
    "--ac-warning-surface": theme.warningSurface,
    "--ac-danger": theme.danger,
    "--ac-done": theme.done,
    "--ac-radius": `${theme.radius}px`,
    fontFamily: FONT_STACK[theme.font],
    color: theme.onSurface,
    backgroundColor: theme.surface,
  } as CSSProperties;
}

function useCardTheme(app: AppBrandId) {
  return appCardTheme(app, useRenderedAppearance() === "dark" ? "dark" : "light");
}

// The brand's monogram tile; T3 Code bundles no logos (docs/user/openui-reports.md).
function BrandTile({ brand }: { brand: AppBrand }) {
  return (
    <span
      aria-hidden
      className="grid size-6 shrink-0 place-items-center rounded-md text-xs font-bold tracking-tight"
      style={{
        backgroundColor: brand.color,
        color: brand.onColor,
        fontSize: brand.mark.length > 1 ? 10 : 13,
      }}
    >
      {brand.mark}
    </span>
  );
}

function AppCard({
  app,
  label,
  children,
}: {
  app: AppBrandId;
  label: string;
  children: ReactNode;
}) {
  const theme = useCardTheme(app);
  return (
    <section
      aria-label={label}
      data-app-card={app}
      className="@container overflow-hidden border motion-safe:transition-[opacity,translate] motion-safe:duration-300 motion-safe:starting:translate-y-1.5 motion-safe:starting:opacity-0"
      style={{
        ...themeVars(theme),
        borderColor: "var(--ac-outline)",
        borderRadius: "var(--ac-radius)",
      }}
    >
      {children}
    </section>
  );
}

function Octicon({
  name: icon,
  className,
  style,
}: {
  name: OcticonName;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={className ?? "size-4 shrink-0"}
      style={style}
      fill="currentColor"
    >
      {OCTICONS[icon].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

function ExternalButton({
  href,
  children,
  tone,
}: {
  href: string;
  children: ReactNode;
  tone: "primary" | "container" | "outline";
}) {
  const style: CSSProperties =
    tone === "primary"
      ? { backgroundColor: "var(--ac-primary)", color: "var(--ac-on-primary)" }
      : tone === "container"
        ? { backgroundColor: "var(--ac-container)", color: "var(--ac-on-container)" }
        : {
            borderColor: "var(--ac-outline)",
            color: "var(--ac-on-surface)",
            backgroundColor: "var(--ac-surface-alt)",
          };
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-transparent px-3.5 text-xs font-medium hover:brightness-95"
      style={style}
    >
      {children}
    </a>
  );
}

const CARS: Record<CarClass, string> = { x: carX, comfort: carComfort, xl: carXl, black: carBlack };
const RIDE_LINKS = { uber: "https://m.uber.com/", lyft: "https://ride.lyft.com/" } as const;
const ROW_HEIGHT = 64;

/** Uber's product picker: vehicle renders, a grey selected row with a black outline that slides, one black button. */
const RideOptionsCard = memo(function RideOptionsCard({
  props,
}: {
  props: z.infer<typeof rideOptionsProps>;
}) {
  const brand = APP_BRANDS[props.app];
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
      app={props.app}
      label={`${brand.name} ride options from ${props.pickup} to ${props.dropoff}`}
    >
      <header className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
        <BrandTile brand={brand} />
        <div className="min-w-0">
          <p className="truncate ac-t17 font-bold">{`Ride to ${props.dropoff}`}</p>
          <p className="truncate text-xs" style={{ color: "var(--ac-muted)" }}>
            {`from ${props.pickup}`}
          </p>
        </div>
        <span className="ml-auto shrink-0 text-xs" style={{ color: "var(--ac-muted)" }}>
          {`Prices from ${brand.name}`}
        </span>
      </header>
      <div className="relative px-2">
        <div
          aria-hidden
          className="absolute inset-x-2 rounded-xl border-2 motion-safe:transition-[top] motion-safe:duration-300 ac-ease-emphasized"
          style={{
            top: selected * ROW_HEIGHT,
            height: ROW_HEIGHT,
            borderColor: "var(--ac-on-surface)",
            backgroundColor: "var(--ac-surface-alt)",
          }}
        />
        {props.options.map((option, index) => (
          <button
            key={option.name}
            type="button"
            aria-pressed={selected === index}
            aria-label={rideReadout(option)}
            onClick={() => setSelected(index)}
            className="relative flex w-full items-center gap-3 rounded-xl pr-3 pl-1 text-left"
            style={{ height: ROW_HEIGHT }}
          >
            <img
              src={CARS[carClass(option.name)]}
              alt=""
              className="h-11 w-[72px] shrink-0 object-contain"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-base leading-tight font-semibold ac-tight">
                {option.name}
                <span className="flex items-center gap-0.5 text-xs font-medium">
                  <svg aria-hidden viewBox="0 0 12 12" className="size-3" fill="currentColor">
                    <circle cx="6" cy="3.6" r="2.3" />
                    <path d="M1.6 11c.4-2.6 2.2-4 4.4-4s4 1.4 4.4 4z" />
                  </svg>
                  {option.seats}
                </span>
                {option.name === best ? (
                  <span
                    className="rounded px-1.5 py-px ac-t11 font-semibold"
                    style={{ color: "var(--ac-success)", backgroundColor: "var(--ac-surface-alt)" }}
                  >
                    Cheapest
                  </span>
                ) : null}
              </span>
              <span className="block truncate ac-t13" style={{ color: "var(--ac-muted)" }}>
                {`${option.arrival ? `${option.arrival} · ` : ""}${option.minutes} min away`}
              </span>
            </span>
            <span className="text-base font-semibold tabular-nums">{option.price}</span>
          </button>
        ))}
      </div>
      <div className="px-4 pt-2 pb-3.5">
        <a
          href={RIDE_LINKS[props.app]}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-12 items-center justify-center rounded-lg text-base font-semibold hover:opacity-90"
          style={{ backgroundColor: "var(--ac-primary)", color: "var(--ac-on-primary)" }}
        >
          {`Choose ${chosen.name}`}
        </a>
        <p role="status" className="pt-2 text-center text-xs" style={{ color: "var(--ac-muted)" }}>
          {`Opens ${brand.name} to confirm. Nothing is booked from here.`}
        </p>
      </div>
    </AppCard>
  );
});

function initials(from: string) {
  return from.trim().charAt(0).toUpperCase() || "?";
}

/** Gmail's list: avatars, bold unread rows, read rows on the tinted surface, attachment chips, a hover lift. */
const MailListCard = memo(function MailListCard({
  props,
}: {
  props: z.infer<typeof mailListProps>;
}) {
  const brand = APP_BRANDS.gmail;
  const [open, setOpen] = useState<number | null>(null);
  return (
    <AppCard app="gmail" label={`Gmail results for ${props.query}`}>
      <header className="flex items-center gap-2.5 px-3 pt-3 pb-2.5">
        <BrandTile brand={brand} />
        <div
          className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full px-4 text-sm"
          style={{ backgroundColor: "var(--ac-surface-alt)" }}
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="size-[18px] shrink-0"
            fill="var(--ac-muted)"
          >
            <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14" />
          </svg>
          <span className="truncate">{props.query}</span>
          <span className="ml-auto shrink-0 text-xs" style={{ color: "var(--ac-muted)" }}>
            {`${props.messages.length} result${props.messages.length === 1 ? "" : "s"}`}
          </span>
        </div>
      </header>
      {props.messages.length === 0 ? (
        <p className="px-4 pb-3 text-sm" style={{ color: "var(--ac-muted)" }}>
          No messages matched.
        </p>
      ) : null}
      <ul className="m-0 list-none p-0">
        {props.messages.map((message, index) => {
          const isOpen = open === index;
          return (
            <li
              key={`${message.from}\u0000${message.subject}\u0000${message.time}`}
              className="list-none border-t"
              style={{ borderColor: "var(--ac-outline)" }}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : index)}
                className="relative flex w-full gap-3 px-3.5 py-2.5 text-left ac-lift motion-safe:transition-shadow"
                style={{
                  backgroundColor: isOpen
                    ? "var(--ac-container)"
                    : message.unread
                      ? "var(--ac-surface)"
                      : "var(--ac-surface-alt)",
                  color: isOpen ? "var(--ac-on-container)" : undefined,
                }}
              >
                <span
                  aria-hidden
                  className="grid size-8 shrink-0 place-items-center rounded-full text-sm font-medium text-white"
                  style={{ backgroundColor: avatarColor(message.from) }}
                >
                  {initials(message.from)}
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="flex items-baseline gap-2">
                    <span
                      className={message.unread ? "flex-1 truncate font-bold" : "flex-1 truncate"}
                    >
                      {message.from}
                    </span>
                    <span
                      className={message.unread ? "shrink-0 text-xs font-bold" : "shrink-0 text-xs"}
                    >
                      {message.time}
                    </span>
                  </span>
                  <span className={message.unread ? "block truncate font-bold" : "block truncate"}>
                    {message.subject}
                  </span>
                  <span
                    className={isOpen ? "block ac-t13" : "block truncate ac-t13"}
                    style={{ color: isOpen ? undefined : "var(--ac-muted)" }}
                  >
                    {message.snippet}
                  </span>
                  {message.attachment ? (
                    <span
                      className="mt-1.5 inline-flex h-8 items-center gap-2 rounded-full border pr-3 pl-2 ac-t13"
                      style={{
                        borderColor: "var(--ac-outline)",
                        backgroundColor: "var(--ac-surface)",
                        color: "var(--ac-on-surface)",
                      }}
                    >
                      <span
                        className="rounded-sm px-1 ac-t8 font-bold text-white"
                        style={{ backgroundColor: brand.color }}
                      >
                        {message.attachment.split(".").pop()?.toUpperCase().slice(0, 4) ?? "FILE"}
                      </span>
                      {message.attachment}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <footer
        className="flex items-center gap-2 border-t px-3.5 py-2.5 text-xs"
        style={{ borderColor: "var(--ac-outline)", color: "var(--ac-muted)" }}
      >
        <span className="hidden min-w-0 flex-1 @sm:block">
          Read-only. Nothing is sent from here.
        </span>
        <span className="flex-1 @sm:hidden" />
        <ExternalButton
          href={`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(props.query)}`}
          tone="container"
        >
          Open in Gmail
        </ExternalButton>
      </footer>
    </AppCard>
  );
});

const MODE_LABEL = {
  drive: "Driving",
  walk: "Walking",
  transit: "Transit",
  bike: "Cycling",
} as const;
const MODE_ICON = {
  drive:
    "M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16m11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5M5 11l1.5-4.5h11L19 11z",
  walk: "M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2M9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6z",
  transit:
    "M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4M7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17m3.5-7H6V6h5zm2 0V6h5v4zm3.5 7c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5",
  bike: "M15.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2M5 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5m0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5m5.8-10 2.4-2.4.8.8c1.3 1.3 3 2.1 5.1 2.1V9c-1.5 0-2.7-.6-3.6-1.5l-1.9-1.9c-.5-.4-1-.6-1.6-.6s-1.1.2-1.4.6L7.8 8.4c-.4.4-.6.9-.6 1.4 0 .6.2 1.1.6 1.4L11 14v5h2v-6.2zM19 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5m0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5",
} as const;
const MAPS_MODE = {
  drive: "driving",
  walk: "walking",
  transit: "transit",
  bike: "bicycling",
} as const;

const MAP_W = 400;
const MAP_H = 200;

/**
 * The route the maps tool returned, drawn in Google's map colours over the tool's static basemap when
 * it sent one. Only real geometry: no path, no map.
 */
function RouteMap({
  path,
  map,
}: {
  path: ReadonlyArray<readonly [number, number]>;
  map: z.infer<typeof routeProps>["map"];
}) {
  const scheme = useRenderedAppearance() === "dark" ? "dark" : "light";
  const paint = MAP_PAINT[scheme];
  const { points, d } = projectPath(path, MAP_W, MAP_H, 22, map?.bounds);
  const start = points[0]!;
  const end = points.at(-1)!;
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      className="block h-auto w-full"
      style={{ backgroundColor: paint.land }}
    >
      {map ? (
        <image
          href={map.image}
          width={MAP_W}
          height={MAP_H}
          preserveAspectRatio="none"
          // Basemaps come light; dark mode turns them into Google's night palette.
          style={scheme === "dark" ? { filter: paint.imageFilter } : undefined}
        />
      ) : null}
      <path
        d={d}
        fill="none"
        stroke={paint.routeCasing}
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={d}
        fill="none"
        stroke={paint.route}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray={1}
        className="ac-route-draw"
      />
      <circle
        cx={start[0]}
        cy={start[1]}
        r="5.5"
        fill={paint.startFill}
        stroke={paint.ink}
        strokeWidth="2.5"
      />
      <g transform={`translate(${end[0]} ${end[1]})`}>
        <path d="M0 0c-7-9-10-13-10-18a10 10 0 0 1 20 0c0 5-3 9-10 18z" fill={paint.pin} />
        <circle cy="-18" r="3.6" fill={paint.pinCore} />
      </g>
    </svg>
  );
}

/** Google Maps' directions panel: the travel time in traffic green, the route, then one step at a time. */
const RouteCard = memo(function RouteCard({ props }: { props: z.infer<typeof routeProps> }) {
  const brand = APP_BRANDS["google-maps"];
  const [step, setStep] = useState(0);
  const total = props.steps.length;
  const query = `origin=${encodeURIComponent(props.origin)}&destination=${encodeURIComponent(props.destination)}&travelmode=${MAPS_MODE[props.mode]}`;
  return (
    <AppCard app="google-maps" label={`Directions from ${props.origin} to ${props.destination}`}>
      <header className="flex items-center gap-2.5 px-4 pt-3.5 pb-1">
        <BrandTile brand={brand} />
        <p className="min-w-0 truncate text-sm">
          <span className="font-medium">{props.origin}</span>
          <span style={{ color: "var(--ac-muted)" }}>{" → "}</span>
          <span className="font-medium">{props.destination}</span>
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-1.5 pb-3">
        <span
          className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 ac-t13 font-medium"
          style={{ backgroundColor: "var(--ac-container)", color: "var(--ac-on-container)" }}
        >
          <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="currentColor">
            <path d={MODE_ICON[props.mode]} />
          </svg>
          {MODE_LABEL[props.mode]}
        </span>
        <span
          className="text-xl font-medium whitespace-nowrap"
          style={{ color: "var(--ac-success)" }}
        >{`${props.minutes} min`}</span>
        <span className="min-w-0 truncate text-sm" style={{ color: "var(--ac-muted)" }}>
          {`${props.distance}${props.via ? ` · via ${props.via}` : ""}`}
        </span>
      </div>
      {props.path ? <RouteMap path={props.path} map={props.map} /> : null}
      {total ? (
        <div
          className="mx-3 my-3 flex items-center gap-3 rounded-xl border px-3 py-2.5"
          style={{ borderColor: "var(--ac-outline)", backgroundColor: "var(--ac-surface-alt)" }}
        >
          <span
            className="grid size-7 shrink-0 place-items-center rounded-full text-xs font-medium"
            style={{ backgroundColor: "var(--ac-primary)", color: "var(--ac-on-primary)" }}
          >
            {step + 1}
          </span>
          <p role="status" className="min-w-0 flex-1 text-sm">
            {props.steps[step]}
          </p>
          <span
            className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums"
            style={{ color: "var(--ac-muted)" }}
          >
            <button
              type="button"
              aria-label="Previous step"
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
              className="grid size-7 place-items-center rounded-full border disabled:opacity-40"
              style={{ borderColor: "var(--ac-outline)", backgroundColor: "var(--ac-surface)" }}
            >
              ‹
            </button>
            {`${step + 1} / ${total}`}
            <button
              type="button"
              aria-label="Next step"
              disabled={step === total - 1}
              onClick={() => setStep(step + 1)}
              className="grid size-7 place-items-center rounded-full border disabled:opacity-40"
              style={{ borderColor: "var(--ac-outline)", backgroundColor: "var(--ac-surface)" }}
            >
              ›
            </button>
          </span>
        </div>
      ) : null}
      <footer
        className="flex items-center gap-2 border-t px-4 py-2.5 text-xs"
        style={{ borderColor: "var(--ac-outline)", color: "var(--ac-muted)" }}
      >
        <span className="hidden min-w-0 flex-1 @sm:block">Route from Google Maps.</span>
        <span className="flex-1 @sm:hidden" />
        <ExternalButton href={`https://www.google.com/maps/dir/?api=1&${query}`} tone="container">
          Open in Maps
        </ExternalButton>
        <ExternalButton
          href={`https://www.google.com/maps/dir/?api=1&${query}&dir_action=navigate`}
          tone="primary"
        >
          Start
        </ExternalButton>
      </footer>
    </AppCard>
  );
});

const STATE = {
  open: { label: "Open", icon: "git-pull-request", tone: "--ac-success" },
  conflict: { label: "Open", icon: "git-pull-request", tone: "--ac-success" },
  ready: { label: "Open", icon: "git-pull-request", tone: "--ac-success" },
  merged: { label: "Merged", icon: "git-merge", tone: "--ac-done" },
  closed: { label: "Closed", icon: "git-pull-request-closed", tone: "--ac-danger" },
} as const satisfies Record<string, { label: string; icon: OcticonName; tone: string }>;
const LANE_COLOR = {
  base: "var(--ac-muted)",
  head: "var(--ac-accent)",
  side: "var(--ac-success)",
} as const;
const ROW = 32;

function CommitGraph({
  commits,
}: {
  commits: NonNullable<z.infer<typeof pullRequestProps>["commits"]>;
}) {
  const height = commits.length * ROW;
  const ys = commits.map((_, index) => index * ROW + ROW / 2);
  const lastOf = (lane: "base" | "head" | "side") => commits.map((c) => c.lane).lastIndexOf(lane);
  const firstOf = (lane: "base" | "head" | "side") => commits.findIndex((c) => c.lane === lane);
  const baseLast = lastOf("base");
  const segments: ReactNode[] = [];
  for (const lane of ["base", "head", "side"] as const) {
    const first = firstOf(lane);
    const last = lastOf(lane);
    if (first < 0) continue;
    const x = commitLaneX(lane);
    segments.push(
      <path
        key={`${lane}-line`}
        d={`M${x} ${ys[first]} V${ys[last]}`}
        stroke={LANE_COLOR[lane]}
        strokeOpacity={0.6}
        strokeWidth={2}
        fill="none"
      />,
    );
    if (lane !== "base" && baseLast > last) {
      const y1 = ys[last]!;
      const y2 = ys[baseLast]!;
      segments.push(
        <path
          key={`${lane}-fork`}
          d={`M${x} ${y1} C${x} ${(y1 + y2) / 2} ${commitLaneX("base")} ${(y1 + y2) / 2} ${commitLaneX("base")} ${y2}`}
          stroke={LANE_COLOR[lane]}
          strokeOpacity={0.6}
          strokeWidth={2}
          fill="none"
        />,
      );
    }
  }
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 z-10"
      width="56"
      height={height}
      viewBox={`0 0 56 ${height}`}
    >
      {segments}
      {commits.map((commit, index) => (
        <circle
          key={commit.sha}
          cx={commitLaneX(commit.lane)}
          cy={ys[index]}
          r={4.5}
          fill={commit.conflict ? "var(--ac-warning)" : "var(--ac-surface)"}
          stroke={commit.conflict ? "var(--ac-warning)" : LANE_COLOR[commit.lane]}
          strokeWidth={2}
        />
      ))}
    </svg>
  );
}

const STATUS_ICON = {
  pass: { icon: "check-circle-fill", tone: "var(--ac-success)" },
  fail: { icon: "x-circle-fill", tone: "var(--ac-danger)" },
  running: { icon: "dot-fill", tone: "var(--ac-warning)" },
  skip: { icon: "skip", tone: "var(--ac-muted)" },
} as const satisfies Record<string, { icon: OcticonName; tone: string }>;

/** GitHub's pull request, in Primer: state label, commits on a graph, checks as a timeline, the merge box line. */
const PullRequestCard = memo(function PullRequestCard({
  props,
}: {
  props: z.infer<typeof pullRequestProps>;
}) {
  const brand = APP_BRANDS.github;
  const state = STATE[props.state];
  const counts = checkCounts(props.checks);
  const timeline = checkTimeline(props.checks);
  const [open, setOpen] = useState<number | null>(() => {
    const failed = props.checks.findIndex((check) => check.status === "fail" && check.detail);
    return failed < 0 ? null : failed;
  });
  const commits = props.commits ?? [];
  const merged = props.state === "merged";
  const foot =
    props.state === "conflict"
      ? {
          icon: "alert" as const,
          tone: "var(--ac-warning)",
          title: `This branch has ${props.conflicts} conflict${props.conflicts === 1 ? "" : "s"} that must be resolved`,
          sub: `Conflicts with ${props.base}`,
        }
      : props.state === "ready"
        ? {
            icon: "check" as const,
            tone: "var(--ac-success)",
            title: "All checks have passed",
            sub: "This branch has no conflicts with the base branch",
          }
        : merged
          ? {
              icon: "git-merge" as const,
              tone: "var(--ac-done)",
              title: "Pull request successfully merged and closed",
              sub: `Merged into ${props.base}`,
            }
          : props.state === "closed"
            ? {
                icon: "git-pull-request-closed" as const,
                tone: "var(--ac-danger)",
                title: "Closed with unmerged commits",
                sub: `${props.head} was not merged`,
              }
            : counts.fail
              ? {
                  icon: "x-circle-fill" as const,
                  tone: "var(--ac-danger)",
                  title: "Some checks were not successful",
                  sub: `${counts.fail} failing, ${counts.pass} successful`,
                }
              : {
                  icon: "dot-fill" as const,
                  tone: "var(--ac-warning)",
                  title: "Some checks haven't completed yet",
                  sub: `${counts.running} in progress, ${counts.pass} successful`,
                };
  return (
    <AppCard app="github" label={`Pull request ${props.number}, ${props.state}`}>
      <header className="flex items-start gap-2.5 px-4 pt-3.5 pb-2">
        <BrandTile brand={brand} />
        <div className="min-w-0 flex-1">
          <p className="ac-t15 leading-snug font-semibold">
            {props.title}{" "}
            <span
              className="font-light"
              style={{ color: "var(--ac-muted)" }}
            >{`#${props.number}`}</span>
          </p>
          <p
            className="mt-1 flex flex-wrap items-center gap-1.5 text-xs"
            style={{ color: "var(--ac-muted)" }}
          >
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-white motion-safe:transition-[background-color,scale] motion-safe:duration-300 motion-safe:starting:scale-90"
              style={{ backgroundColor: `var(${state.tone})` }}
            >
              <Octicon name={state.icon} className="size-3.5" />
              {state.label}
            </span>
            <span
              className="rounded-md px-1.5 py-0.5"
              style={{
                fontFamily: MONO,
                backgroundColor: "var(--ac-container)",
                color: "var(--ac-on-container)",
              }}
            >
              {props.head}
            </span>
            →
            <span
              className="rounded-md px-1.5 py-0.5"
              style={{
                fontFamily: MONO,
                backgroundColor: "var(--ac-container)",
                color: "var(--ac-on-container)",
              }}
            >
              {props.base}
            </span>
          </p>
        </div>
      </header>
      {commits.length ? (
        <ol
          className="relative m-0 list-none border-t p-0"
          style={{ borderColor: "var(--ac-outline)" }}
        >
          <CommitGraph commits={commits} />
          {commits.map((commit, index) => (
            <li
              key={commit.sha}
              className="relative flex list-none items-center gap-2 pr-4 pl-14 ac-t13 motion-safe:transition-[opacity,translate] motion-safe:duration-300 motion-safe:starting:-translate-y-1 motion-safe:starting:opacity-0"
              style={{
                height: ROW,
                transitionDelay: `${index * 40}ms`,
                backgroundColor: commit.conflict ? "var(--ac-warning-surface)" : undefined,
              }}
            >
              <span
                className="min-w-0 flex-1 truncate @md:flex-initial"
                style={{ color: commit.lane === "head" ? undefined : "var(--ac-muted)" }}
              >
                {commit.title}
              </span>
              {commit.branch ? (
                <span
                  className="hidden shrink-0 rounded-md px-1.5 ac-t11 leading-5 @md:inline"
                  style={{
                    fontFamily: MONO,
                    backgroundColor: "var(--ac-container)",
                    color: "var(--ac-on-container)",
                  }}
                >
                  {commit.branch}
                </span>
              ) : null}
              <span
                className="ml-auto flex shrink-0 items-baseline gap-1.5 text-xs"
                style={{ color: "var(--ac-muted)" }}
              >
                <span className="ac-t11" style={{ fontFamily: MONO }}>
                  {commit.sha.slice(0, 7)}
                </span>
                <span className="hidden @sm:inline">{`${commit.author} · ${commit.age}`}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {props.checks.length ? (
        <div
          className="border-t py-1.5"
          style={{ borderColor: "var(--ac-outline)", backgroundColor: "var(--ac-surface-alt)" }}
        >
          {props.checks.map((check, index) => {
            const status = STATUS_ICON[check.status];
            const span = timeline?.spans[index];
            const expandable = Boolean(check.detail);
            return (
              <div key={`${check.name}\u0000${check.status}`}>
                <button
                  type="button"
                  aria-expanded={expandable ? open === index : undefined}
                  disabled={!expandable}
                  onClick={() => setOpen(open === index ? null : index)}
                  className="grid w-full grid-cols-[16px_minmax(0,9rem)_1fr_3rem] items-center gap-2 px-4 py-1.5 text-left ac-t13 disabled:cursor-default"
                >
                  <Octicon name={status.icon} style={{ color: status.tone }} />
                  <span className="truncate font-medium">{check.name}</span>
                  {span ? (
                    <span className="relative h-1.5">
                      <span
                        className="absolute inset-y-0 rounded-full motion-safe:transition-[scale] motion-safe:duration-700 motion-safe:starting:scale-x-0"
                        style={{
                          left: `${span.start * 100}%`,
                          width: `${Math.max(span.length * 100, 1.5)}%`,
                          transformOrigin: "left",
                          backgroundColor: status.tone,
                          transitionDelay: `${Math.round(span.start * 600)}ms`,
                        }}
                      />
                    </span>
                  ) : (
                    <span className="truncate text-xs" style={{ color: "var(--ac-muted)" }}>
                      {check.status === "pass"
                        ? "Successful"
                        : check.status === "fail"
                          ? "Failing"
                          : check.status === "running"
                            ? "In progress"
                            : "Skipped"}
                    </span>
                  )}
                  <span
                    className="text-right text-xs tabular-nums"
                    style={{
                      color: check.status === "fail" ? "var(--ac-danger)" : "var(--ac-muted)",
                    }}
                  >
                    {check.seconds !== undefined ? formatSeconds(check.seconds) : ""}
                  </span>
                </button>
                {expandable && open === index ? (
                  <p
                    role="status"
                    className="mx-4 mb-1.5 rounded-md border px-2.5 py-1.5 text-xs whitespace-pre-wrap"
                    style={{
                      fontFamily: MONO,
                      borderColor: "var(--ac-outline)",
                      backgroundColor: "var(--ac-surface)",
                      color: check.status === "fail" ? "var(--ac-danger)" : "var(--ac-muted)",
                    }}
                  >
                    {check.detail}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <footer
        className="flex items-center gap-3 border-t px-4 py-3"
        style={{ borderColor: "var(--ac-outline)" }}
      >
        <span
          className="grid size-8 shrink-0 place-items-center rounded-full text-white"
          style={{ backgroundColor: foot.tone }}
        >
          <Octicon name={foot.icon} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block ac-t13 font-semibold">{foot.title}</span>
          <span className="block truncate text-xs" style={{ color: "var(--ac-muted)" }}>
            {foot.sub}
          </span>
        </span>
        <ExternalButton href="https://github.com/pulls" tone="outline">
          Open on GitHub
        </ExternalButton>
      </footer>
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
