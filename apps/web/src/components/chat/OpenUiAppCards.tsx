import { defineComponent } from "@openuidev/react-lang";
import { memo, useState, type ReactNode } from "react";
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
});

function CardShell({
  brand,
  subtitle,
  label,
  children,
}: {
  brand: AppBrand;
  subtitle: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="h-[3px]" style={{ backgroundColor: brand.color }} />
      <header className="flex items-center gap-2.5 p-3">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-lg font-bold"
          style={{
            backgroundColor: brand.color,
            color: brand.onColor,
            fontSize: brand.mark.length > 1 ? 11 : 15,
          }}
        >
          {brand.mark}
        </span>
        <div className="min-w-0">
          <p className="font-semibold">{brand.name}</p>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </header>
      <div className="space-y-2 px-3 pb-3">{children}</div>
    </section>
  );
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-2xs font-semibold"
      style={{ color, backgroundColor: `${color}22` }}
    >
      {label}
    </span>
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
  const ring = brand.color === "#000000" ? "#888888" : brand.color;
  return (
    <CardShell
      brand={brand}
      subtitle={`${props.pickup} → ${props.dropoff}`}
      label={`${brand.name} ride options from ${props.pickup} to ${props.dropoff}`}
    >
      {props.options.map((option, index) => (
        <button
          key={option.name}
          type="button"
          aria-pressed={selected === index}
          aria-label={rideReadout(option)}
          onClick={() => setSelected(index)}
          className="flex w-full items-center gap-2.5 rounded-lg border p-2.5 text-left"
          style={{
            borderColor: selected === index ? ring : undefined,
            borderWidth: selected === index ? 2 : 1,
          }}
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 font-semibold">
              {option.name}
              {option.name === best ? <Tag label="Best price" color="#1A7F37" /> : null}
            </span>
            <span className="block text-xs text-muted-foreground">{`${option.minutes} min away · ${option.seats} seats`}</span>
          </span>
          <span className="text-base font-semibold">{option.price}</span>
        </button>
      ))}
      <p role="status" className="text-xs text-muted-foreground">
        {selected === null
          ? `Prices from ${brand.name}. Booking happens in the ${brand.name} app.`
          : rideReadout(props.options[selected]!)}
      </p>
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
      label={`Gmail results for ${props.query}`}
    >
      {props.messages.length === 0 ? (
        <p className="text-muted-foreground">No messages matched.</p>
      ) : null}
      <ul className="m-0 list-none divide-y divide-border p-0">
        {props.messages.map((message, index) => (
          <li
            key={`${message.from}\u0000${message.subject}\u0000${message.time}`}
            className="list-none"
          >
            <button
              type="button"
              aria-expanded={open === index}
              onClick={() => setOpen(open === index ? null : index)}
              className="flex w-full gap-2 py-1.5 text-left"
            >
              <span className="w-2 pt-1.5">
                {message.unread ? (
                  <span
                    aria-label="Unread"
                    className="block size-2 rounded-full"
                    style={{ backgroundColor: brand.color }}
                  />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex gap-2">
                  <span
                    className={message.unread ? "flex-1 truncate font-semibold" : "flex-1 truncate"}
                  >
                    {message.from}
                  </span>
                  <span className="text-xs text-muted-foreground">{message.time}</span>
                </span>
                <span
                  className={message.unread ? "block truncate font-semibold" : "block truncate"}
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
              </span>
            </button>
          </li>
        ))}
      </ul>
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
      label={`Directions from ${props.origin} to ${props.destination}`}
    >
      <p className="flex items-baseline gap-2">
        <span
          className="text-2xl font-bold"
          style={{ color: brand.color }}
        >{`${props.minutes} min`}</span>
        <span className="text-muted-foreground">{props.distance}</span>
      </p>
      <ol className="m-0 list-none space-y-1 p-0">
        {props.steps.map((entry, index) => (
          <li key={`${index + 1}. ${entry}`} className="list-none">
            <button
              type="button"
              aria-pressed={step === index}
              onClick={() => setStep(index)}
              className="flex w-full items-start gap-2.5 text-left"
            >
              <span
                className="grid size-[18px] shrink-0 place-items-center rounded-full text-3xs font-bold"
                style={{
                  backgroundColor: step === index ? brand.color : `${brand.color}22`,
                  color: step === index ? brand.onColor : brand.color,
                }}
              >
                {index + 1}
              </span>
              <span className={step === index ? "font-semibold" : undefined}>{entry}</span>
            </button>
          </li>
        ))}
      </ol>
    </CardShell>
  );
});

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
  const merged = props.state === "merged";
  const [check, setCheck] = useState<number | null>(null);
  return (
    <CardShell
      brand={brand}
      subtitle={`#${props.number} · ${props.head} → ${props.base}`}
      label={`Pull request ${props.number}, ${STATE_LABEL[props.state]}`}
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 font-semibold">{props.title}</p>
        {merged ? (
          // A merged pull request plays its fill once on insertion (@starting-style); reduced motion skips it.
          <span
            className="rounded-full px-2.5 py-0.5 text-xs font-bold text-white motion-safe:transition-[opacity,scale] motion-safe:delay-700 motion-safe:duration-200 motion-safe:starting:scale-60 motion-safe:starting:opacity-0"
            style={{ backgroundColor: stateColor }}
          >
            Merged
          </span>
        ) : (
          <Tag label={STATE_LABEL[props.state]} color={stateColor} />
        )}
      </div>
      <div className="h-1 overflow-hidden rounded bg-muted">
        <div
          className={
            merged
              ? "h-1 origin-left rounded motion-safe:transition-[scale] motion-safe:delay-150 motion-safe:duration-700 motion-safe:starting:scale-x-75"
              : "h-1 rounded"
          }
          style={{ width: `${(reached / steps.length) * 100}%`, backgroundColor: stateColor }}
        />
      </div>
      <div className="flex justify-between text-2xs">
        {steps.map((entry) => (
          <span
            key={entry.name}
            className={entry.reached ? "font-semibold" : "text-muted-foreground"}
          >
            {entry.name}
          </span>
        ))}
      </div>
      {props.state === "conflict" ? (
        <p
          className="text-xs font-semibold"
          style={{ color: stateColor }}
        >{`${props.conflicts} conflict${props.conflicts === 1 ? "" : "s"} with ${props.base}`}</p>
      ) : null}
      {props.checks.length ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{`Checks · ${counts.pass} passed${counts.fail ? ` · ${counts.fail} failed` : ""}${counts.running ? ` · ${counts.running} running` : ""}${counts.skip ? ` · ${counts.skip} skipped` : ""}`}</p>
          <div className="flex flex-wrap gap-1.5">
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
                  className="flex items-center gap-1 rounded-full border px-2 py-1 text-xs"
                  style={{ borderColor: check === index ? color : undefined }}
                >
                  <span aria-hidden className="font-bold" style={{ color }}>
                    {CHECK_STATUS_SYMBOL[entry.status]}
                  </span>
                  {entry.name}
                </button>
              );
            })}
          </div>
          {check !== null && props.checks[check]?.detail ? (
            <p
              role="status"
              className="text-xs text-muted-foreground"
            >{`${props.checks[check]!.name}: ${props.checks[check]!.detail}`}</p>
          ) : null}
        </div>
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
