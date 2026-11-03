import { defineComponent } from "@openuidev/react-lang";
import { memo, useState, type CSSProperties, type ReactNode } from "react";
import { z } from "zod/v4";

import { APP_BRANDS, type AppBrand } from "@t3tools/client-runtime/app-connectors";
import {
  APP_CARD_DESCRIPTIONS as DESCRIPTIONS,
  APP_CARD_LIMITS as LIMITS,
  APP_CARD_PAINT as PAINT,
  PULL_REQUEST_STATE_COLORS,
  avatarColor,
  cheapestRide,
  checkCounts,
  commitLaneX,
  rideReadout,
} from "@t3tools/client-runtime/openui-app-cards";

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

// The brand's monogram tile; T3 Code bundles no logos (docs/user/openui-reports.md).
function BrandLogo({ brand }: { brand: AppBrand }) {
  return (
    <span
      aria-hidden
      className="grid size-6 place-items-center rounded-md text-xs font-bold tracking-tight"
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

function CardShell({
  brand,
  title,
  subtitle,
  meta,
  label,
  children,
}: {
  brand: AppBrand;
  title: string;
  subtitle: string;
  meta?: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs motion-safe:transition-[opacity,translate] motion-safe:duration-300 motion-safe:starting:translate-y-1 motion-safe:starting:opacity-0"
    >
      <header className="flex items-center gap-2.5 px-3.5 py-3">
        <span className="grid size-6 shrink-0 place-items-center">
          <BrandLogo brand={brand} />
        </span>
        <p className="shrink-0 font-semibold tracking-tight">{title}</p>
        <p className="min-w-0 truncate text-muted-foreground">{subtitle}</p>
        {meta ? <div className="ml-auto shrink-0 text-xs text-muted-foreground">{meta}</div> : null}
      </header>
      {children}
    </section>
  );
}

function CardFoot({ note, action }: { note: string; action?: ReactNode }) {
  return (
    <footer className="flex items-center gap-2 border-t border-border px-3.5 py-2.5 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1">{note}</span>
      {action}
    </footer>
  );
}

function OutLink({
  href,
  children,
  style,
}: {
  href: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="shrink-0 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
      style={style}
    >
      {children}
    </a>
  );
}

function CarGlyph({ tone }: { tone: string }) {
  return (
    <svg aria-hidden viewBox="0 0 86 52" className="h-8 w-14 shrink-0">
      <ellipse cx="43" cy="44" rx="36" ry="4" fill={PAINT.shadow} />
      <path
        d="M8 36c0-5 2-8 7-9l9-2 9-8c2-2 5-3 8-3h12c3 0 5 1 7 3l8 8 7 1c4 1 6 4 6 8v3c0 1-1 2-2 2H10c-1 0-2-1-2-2z"
        fill={tone}
      />
      <path d="M30 25l7-7c1.5-1.5 3-2 5-2h4v9zM50 16h3c2 0 3.5.5 5 2l6 7H50z" fill={PAINT.glass} />
      <circle cx="24" cy="40" r="6.5" fill={PAINT.tyre} />
      <circle cx="63" cy="40" r="6.5" fill={PAINT.tyre} />
    </svg>
  );
}
const CAR_TONES = [
  "#e9e9e9",
  "#3a3f47",
  "#f4f4f4",
  "#151515",
  "#c9ced6",
  "#6b7280",
  "#e5e7eb",
  "#111827",
];
const RIDE_LINKS = { uber: "https://m.uber.com/", lyft: "https://ride.lyft.com/" } as const;

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
    <CardShell
      brand={brand}
      title={`Ride to ${props.dropoff}`}
      subtitle={`from ${props.pickup}`}
      meta={`Prices from ${brand.name}`}
      label={`${brand.name} ride options from ${props.pickup} to ${props.dropoff}`}
    >
      <div className="space-y-1 px-2 pb-2">
        {props.options.map((option, index) => (
          <button
            key={option.name}
            type="button"
            aria-pressed={selected === index}
            aria-label={rideReadout(option)}
            onClick={() => setSelected(index)}
            className="flex w-full items-center gap-3 rounded-xl border-2 px-2.5 py-2 text-left motion-safe:transition-[border-color,background-color] motion-safe:duration-150"
            style={{
              borderColor: selected === index ? "var(--foreground)" : "transparent",
              backgroundColor: selected === index ? "var(--muted)" : undefined,
            }}
          >
            <CarGlyph tone={CAR_TONES[index % CAR_TONES.length]!} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-semibold">
                {option.name}
                <span className="text-xs font-normal text-muted-foreground">{`· ${option.seats} seats`}</span>
                {option.name === best ? (
                  <span
                    className="rounded-md px-1.5 py-px text-2xs font-semibold"
                    style={{ color: PAINT.cheapest, backgroundColor: `${PAINT.cheapest}1f` }}
                  >
                    Cheapest
                  </span>
                ) : null}
              </span>
              <span className="block text-xs text-muted-foreground">
                {`${option.minutes} min away${option.arrival ? ` · ${option.arrival}` : ""}`}
              </span>
            </span>
            <span className="text-base font-semibold tabular-nums">{option.price}</span>
          </button>
        ))}
      </div>
      <div className="px-3.5 pb-3">
        <a
          href={RIDE_LINKS[props.app]}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-11 items-center justify-center rounded-xl text-sm font-semibold"
          style={{
            backgroundColor: brand.color === "#000000" ? "#000" : brand.color,
            color: brand.onColor,
          }}
        >
          {`Request ${chosen.name} · ${chosen.price}`}
        </a>
        <p role="status" className="pt-2 text-center text-xs text-muted-foreground">
          {`Opens ${brand.name} to confirm. Nothing is booked from here.`}
        </p>
      </div>
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
  return (
    <CardShell
      brand={brand}
      title="Gmail"
      subtitle={`“${props.query}”`}
      meta={`${props.messages.length} result${props.messages.length === 1 ? "" : "s"}`}
      label={`Gmail results for ${props.query}`}
    >
      {props.messages.length === 0 ? (
        <p className="px-3.5 pb-3 text-muted-foreground">No messages matched.</p>
      ) : null}
      <ul className="m-0 list-none p-0">
        {props.messages.map((message, index) => (
          <li
            key={`${message.from}\u0000${message.subject}\u0000${message.time}`}
            className="list-none border-t border-border"
          >
            <button
              type="button"
              aria-expanded={open === index}
              onClick={() => setOpen(open === index ? null : index)}
              className="flex w-full gap-3 px-3.5 py-2.5 text-left hover:bg-muted/50"
              style={{
                backgroundColor:
                  open === index ? "color-mix(in srgb, #1a73e8 7%, transparent)" : undefined,
              }}
            >
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold text-white"
                style={{ backgroundColor: avatarColor(message.from) }}
              >
                {message.from.trim().charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span
                    className={message.unread ? "flex-1 truncate font-semibold" : "flex-1 truncate"}
                  >
                    {message.from}
                  </span>
                  <span
                    className={
                      message.unread ? "text-xs font-semibold" : "text-xs text-muted-foreground"
                    }
                  >
                    {message.time}
                  </span>
                </span>
                <span
                  className={
                    message.unread
                      ? "block truncate font-medium"
                      : "block truncate text-muted-foreground"
                  }
                >
                  {message.subject}
                </span>
                <span
                  className={
                    open === index
                      ? "block text-xs text-muted-foreground"
                      : "block truncate text-xs text-muted-foreground"
                  }
                >
                  {message.snippet}
                </span>
                {message.attachment ? (
                  <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-border py-1 pr-2.5 pl-1.5 text-xs">
                    <span
                      className="rounded-sm px-1 text-3xs leading-4 font-bold text-white"
                      style={{ backgroundColor: PAINT.googleRed }}
                    >
                      {message.attachment.split(".").pop()?.toUpperCase().slice(0, 4) ?? "FILE"}
                    </span>
                    {message.attachment}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <CardFoot
        note="Read-only. Nothing is sent from here."
        action={
          <OutLink
            href={`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(props.query)}`}
            style={{
              color: "#1a56d6",
              backgroundColor: "color-mix(in srgb, #1a73e8 9%, transparent)",
            }}
          >
            Open in Gmail
          </OutLink>
        }
      />
    </CardShell>
  );
});

const MODE_LABEL = {
  drive: "Driving",
  walk: "Walking",
  transit: "Transit",
  bike: "Cycling",
} as const;

/** A schematic of the route that fills as the steps advance. Not a map: no geometry is known. */
function RouteStrip({ steps, active }: { steps: number; active: number }) {
  const n = Math.max(1, steps);
  return (
    <svg aria-hidden viewBox="0 0 600 64" className="h-14 w-full">
      <path
        d="M24 40 C 160 8 260 60 360 30 S 520 20 576 34"
        stroke={PAINT.routeCasing}
        strokeWidth="10"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M24 40 C 160 8 260 60 360 30 S 520 20 576 34"
        stroke={PAINT.routeBlue}
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - (active + 1) / (n + 1)}
        className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-500"
      />
      <circle cx="24" cy="40" r="8" fill={PAINT.white} />
      <circle cx="24" cy="40" r="5.5" fill={PAINT.routeBlue} />
      <path
        d="M576 34c-7-8-9-12-9-15a9 9 0 0 1 18 0c0 3-2 7-9 15z"
        fill={PAINT.googleRed}
        transform="translate(0 -4)"
      />
    </svg>
  );
}

const RouteCard = memo(function RouteCard({ props }: { props: z.infer<typeof routeProps> }) {
  const brand = APP_BRANDS["google-maps"];
  const [step, setStep] = useState(0);
  const total = props.steps.length;
  const mapsMode = { drive: "driving", walk: "walking", transit: "transit", bike: "bicycling" }[
    props.mode
  ];
  return (
    <CardShell
      brand={brand}
      title="Directions"
      subtitle={`${props.origin} → ${props.destination}`}
      meta={MODE_LABEL[props.mode]}
      label={`Directions from ${props.origin} to ${props.destination}`}
    >
      <div className="px-3.5">
        <p className="flex items-baseline gap-2">
          <span
            className="text-2xl font-semibold tracking-tight"
            style={{ color: brand.color }}
          >{`${props.minutes} min`}</span>
          <span className="text-muted-foreground">{props.distance}</span>
        </p>
        <RouteStrip steps={total} active={step} />
      </div>
      {total ? (
        <div className="mx-3.5 mb-3 flex items-center gap-3 rounded-xl border border-border bg-muted/60 px-3 py-2.5">
          <span
            className="grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
            style={{ backgroundColor: PAINT.routeBlue }}
          >
            {step + 1}
          </span>
          <p role="status" className="min-w-0 flex-1 text-sm">
            {props.steps[step]}
          </p>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <button
              type="button"
              aria-label="Previous step"
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
              className="grid size-7 place-items-center rounded-full border border-border bg-card disabled:opacity-40"
            >
              ‹
            </button>
            {`${step + 1} / ${total}`}
            <button
              type="button"
              aria-label="Next step"
              disabled={step === total - 1}
              onClick={() => setStep(step + 1)}
              className="grid size-7 place-items-center rounded-full border border-border bg-card disabled:opacity-40"
            >
              ›
            </button>
          </span>
        </div>
      ) : null}
      <CardFoot
        note="Route from Google Maps. Nothing is sent to your phone from here."
        action={
          <OutLink
            href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(props.origin)}&destination=${encodeURIComponent(props.destination)}&travelmode=${mapsMode}`}
            style={{
              color: "#0b57d0",
              backgroundColor: "color-mix(in srgb, #1a73e8 10%, transparent)",
            }}
          >
            Open in Maps
          </OutLink>
        }
      />
    </CardShell>
  );
});

// After @pitus_'s "Generative UI #2 - Merge conflicts": a commit graph with lanes, conflicting rows
// marked on the base lane, checks as chips, and the state said once in the footer.
const STATE_LABEL = {
  open: "Open",
  conflict: "Open",
  ready: "Open",
  merged: "Merged",
  closed: "Closed",
} as const;
const LANE_COLOR = { base: "#bdbdbd", head: "#3d7be0", side: "#22c39b" } as const;
const LANE_TAG = {
  base: "bg-muted text-muted-foreground",
  head: "bg-[#edf3fe] text-[#2a5bc8] dark:bg-[#3d7be0]/15 dark:text-[#8db4f5]",
  side: "bg-[#e9f8f2] text-[#0f8a68] dark:bg-[#22c39b]/15 dark:text-[#5fd9b6]",
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
        strokeOpacity={0.5}
        strokeWidth={1.5}
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
          strokeOpacity={0.5}
          strokeWidth={1.5}
          fill="none"
        />,
      );
    }
  }
  return (
    <svg
      aria-hidden
      className="absolute top-0 left-0"
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
          r={commit.lane === "base" ? 3.5 : 4}
          fill={commit.conflict ? "#f0a020" : LANE_COLOR[commit.lane]}
        />
      ))}
    </svg>
  );
}

const PullRequestCard = memo(function PullRequestCard({
  props,
}: {
  props: z.infer<typeof pullRequestProps>;
}) {
  const brand = APP_BRANDS.github;
  const stateColor = PULL_REQUEST_STATE_COLORS[props.state];
  const counts = checkCounts(props.checks);
  const [check, setCheck] = useState<number | null>(null);
  const commits = props.commits ?? [];
  const merged = props.state === "merged";
  const foot =
    props.state === "conflict"
      ? `${props.conflicts} conflict${props.conflicts === 1 ? "" : "s"} with ${props.base}`
      : props.state === "ready"
        ? "Ready to merge"
        : merged
          ? `Merged into ${props.base}`
          : props.state === "closed"
            ? "Closed without merging"
            : counts.running
              ? `Checks running · ${counts.pass} of ${props.checks.length} passed`
              : `${props.head} → ${props.base}`;
  return (
    <section
      aria-label={`Pull request ${props.number}, ${props.state}`}
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs motion-safe:transition-[opacity,translate] motion-safe:duration-300 motion-safe:starting:translate-y-1 motion-safe:starting:opacity-0"
    >
      <header className="flex items-center gap-2.5 px-3.5 pt-3 pb-1.5">
        <BrandLogo brand={brand} />
        <p className="min-w-0 flex-1 truncate font-semibold tracking-tight">
          {props.title}{" "}
          <span className="font-normal text-muted-foreground">{`#${props.number}`}</span>
        </p>
        <span
          className="flex shrink-0 items-center gap-1.5 text-xs font-medium motion-safe:transition-[opacity,scale] motion-safe:duration-200 motion-safe:starting:scale-75 motion-safe:starting:opacity-0"
          style={{ color: stateColor }}
        >
          <span className="size-2 rounded-full" style={{ backgroundColor: stateColor }} />
          {STATE_LABEL[props.state]}
        </span>
      </header>
      {commits.length ? (
        <ol className="relative m-0 list-none p-0 pb-1">
          <CommitGraph commits={commits} />
          {commits.map((commit, index) => (
            <li
              key={commit.sha}
              className="relative flex list-none items-center gap-2 pr-3.5 pl-14 text-sm motion-safe:transition-[opacity,translate] motion-safe:duration-300 motion-safe:starting:-translate-y-1 motion-safe:starting:opacity-0"
              style={{
                height: ROW,
                transitionDelay: `${index * 40}ms`,
                backgroundColor: commit.conflict
                  ? "color-mix(in srgb, #f0a020 9%, transparent)"
                  : undefined,
              }}
            >
              <span
                className={
                  commit.lane === "head"
                    ? "min-w-0 truncate"
                    : "min-w-0 truncate text-muted-foreground"
                }
                style={commit.conflict ? { color: "#b8650e" } : undefined}
              >
                {commit.title}
              </span>
              {commit.branch ? (
                <span
                  className={`shrink-0 rounded-md px-1.5 font-mono text-2xs leading-5 ${LANE_TAG[commit.lane]}`}
                >
                  {commit.branch}
                </span>
              ) : null}
              <span className="ml-auto flex shrink-0 items-baseline gap-1.5 text-xs text-muted-foreground">
                <span className="font-mono text-2xs opacity-70">{commit.sha.slice(0, 6)}</span>
                {`${commit.author} · ${commit.age}`}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-3.5 pb-1 text-xs text-muted-foreground">{`${props.head} → ${props.base}`}</p>
      )}
      {props.checks.length ? (
        <div className="flex flex-wrap gap-1.5 px-3.5 py-2">
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
              <button
                key={`${entry.name}\u0000${entry.status}\u0000${entry.detail}`}
                type="button"
                aria-pressed={check === index}
                aria-label={`${entry.name}: ${entry.status}${entry.detail ? `, ${entry.detail}` : ""}`}
                onClick={() => setCheck(check === index ? null : index)}
                className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs motion-safe:transition-[opacity,scale] motion-safe:duration-200 motion-safe:starting:scale-90 motion-safe:starting:opacity-0"
                style={{
                  borderColor: check === index ? color : undefined,
                  transitionDelay: `${index * 60}ms`,
                }}
              >
                <svg aria-hidden viewBox="0 0 14 14" className="size-3">
                  {entry.status === "pass" ? (
                    <path
                      d="M3 7.4l2.6 2.6L11 4.4"
                      fill="none"
                      stroke={color}
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : entry.status === "fail" ? (
                    <path
                      d="M4 4l6 6M10 4l-6 6"
                      stroke={color}
                      strokeWidth="1.9"
                      strokeLinecap="round"
                    />
                  ) : (
                    <circle cx="7" cy="7" r="3" fill={color} />
                  )}
                </svg>
                {entry.name}
                <span className="text-muted-foreground">
                  {entry.status === "pass"
                    ? "passed"
                    : entry.status === "fail"
                      ? "failed"
                      : entry.status === "running"
                        ? "running"
                        : "skipped"}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {check !== null && props.checks[check]?.detail ? (
        <p role="status" className="px-3.5 pb-1 text-xs text-muted-foreground">
          {`${props.checks[check]!.name}: ${props.checks[check]!.detail}`}
        </p>
      ) : null}
      <CardFoot
        note={foot}
        action={
          <OutLink href="https://github.com/pulls">{merged ? "GitHub" : "Open on GitHub"}</OutLink>
        }
      />
    </section>
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
