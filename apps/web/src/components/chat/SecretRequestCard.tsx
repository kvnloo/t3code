import { pipe } from "effect/Function";
import {
  SECRET_REQUEST_DEFAULT_PLACEHOLDER,
  secretRequestAnswerInput,
  secretRequestDisplay,
  secretRequestCanReopen,
  secretRequestFailureMessage,
  secretRequestPrivacyNote,
  type SecretRequestItem,
} from "@t3tools/client-runtime/secret-request";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  OrchestrationV2ProjectedTurnItem,
  SecretRequestReopenResult,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { CheckIcon, LockIcon, MinusIcon, ShieldCheckIcon } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { WorkLogRow } from "./WorkLog";

export function SecretRequestCard(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SecretRequestItem;
  readonly visibility: OrchestrationV2ProjectedTurnItem["visibility"];
}) {
  const { item } = props;
  const display = secretRequestDisplay(item, props.visibility);
  if (display.kind === "answered" || display.kind === "pending-elsewhere") {
    const Icon =
      display.kind === "pending-elsewhere"
        ? LockIcon
        : display.outcome === "saved"
          ? CheckIcon
          : MinusIcon;
    return (
      <WorkLogRow
        data-v2-item-type={item.type}
        icon={<Icon className="size-3.5 text-icon-muted" aria-hidden />}
        label={
          <>
            {item.label} · {display.label}
          </>
        }
      >
        {secretRequestCanReopen(item, props.visibility) ? (
          <SecretRequestRecovery environmentId={props.environmentId} item={item} />
        ) : null}
      </WorkLogRow>
    );
  }
  return <PendingSecretRequestForm environmentId={props.environmentId} item={item} />;
}

function SecretRequestRecovery(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SecretRequestItem;
}) {
  const canOperate = useAtomValue(
    serverEnvironment.reopenSecretRequest.permissionAtom(props.environmentId),
  );
  const reopen = useAtomCommand(serverEnvironment.reopenSecretRequest, {
    label: "reopen secure prompt",
    reportFailure: false,
    reportDefect: false,
  });
  const [result, setResult] = useState<SecretRequestReopenResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const send = async (showReference: boolean) => {
    if (inFlight.current || !canOperate) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const reply = await reopen({
        environmentId: props.environmentId,
        input: {
          threadId: props.item.threadId,
          turnItemId: showReference ? (props.item.parentItemId ?? props.item.id) : props.item.id,
        },
      });
      if (reply._tag === "Success") setResult(reply.value);
      else if (!isAtomCommandInterrupted(reply))
        setError(secretRequestFailureMessage(squashAtomCommandFailure(reply)));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-start gap-2 py-2">
      <Button
        type="button"
        size="xs"
        variant="ghost-muted"
        disabled={busy || !canOperate}
        onClick={() => void send(false)}
      >
        {busy ? "Opening…" : "Reopen secure prompt"}
      </Button>
      {props.item.secretStatus === "saved" && props.item.parentItemId !== null ? (
        <Button
          type="button"
          size="xs"
          variant="ghost-muted"
          disabled={busy || !canOperate}
          onClick={() => void send(true)}
        >
          Show secure reference
        </Button>
      ) : null}
      {result?.state === "pending" ? (
        <p role="status" className="text-xs text-muted-foreground">
          Secure prompt reopened below. The agent has not been resumed.
        </p>
      ) : null}
      {result?.state === "ended" ? (
        <p role="status" className="text-xs text-muted-foreground">
          The reopened request ended. Reopen its card to try again.
        </p>
      ) : null}
      {result?.state === "saved" ? (
        <p role="status" className="text-xs text-muted-foreground">
          Use this {result.delivery.type === "ref" ? "one-use reference" : "private file path"}{" "}
          instead of the secret:{" "}
          <code>{result.delivery.type === "ref" ? result.delivery.ref : result.delivery.path}</code>
        </p>
      ) : null}
      {error !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PendingSecretRequestForm(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SecretRequestItem;
}) {
  const { item } = props;
  const inputId = useId();
  const errorId = useId();
  const privacyId = useId();
  const canAnswer = useAtomValue(
    serverEnvironment.answerSecretRequest.permissionAtom(props.environmentId),
  );
  const answer = useAtomCommand(serverEnvironment.answerSecretRequest, {
    label: "answer secret request",
    // The failure cause holds the request; keep it out of the console.
    reportFailure: false,
    reportDefect: false,
  });
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Enter and click can both submit before a render.
  const inFlight = useRef(false);

  const send = async (
    reply: { readonly type: "save"; readonly secret: string } | { readonly type: "decline" },
  ) => {
    const input = secretRequestAnswerInput(item, reply);
    if (input === null || inFlight.current || !canAnswer) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const result = await answer({ environmentId: props.environmentId, input }).finally(() => {
      inFlight.current = false;
      setSubmitting(false);
    });
    if (result._tag === "Success") {
      setSecret("");
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      pipe(squashAtomCommandFailure(result), secretRequestFailureMessage, setError);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send({ type: "save", secret });
  };

  return (
    <form
      data-v2-item-type={item.type}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-card p-4"
      onSubmit={onSubmit}
      autoComplete="off"
      // On click, not pointerdown: the mousedown that follows a pointerdown
      // moves focus back off the input. A click that ends a text selection
      // leaves it alone so the reason can still be copied.
      onClick={(event) => {
        if (!(event.target instanceof Element)) return;
        if (event.target.closest("input, button, a")) return;
        if (window.getSelection()?.isCollapsed === false) return;
        document.getElementById(inputId)?.focus();
      }}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {item.label}
        </label>
        {item.reason.trim() ? (
          <p className="text-sm wrap-anywhere text-muted-foreground">{item.reason}</p>
        ) : null}
      </div>
      {item.parentItemId !== null ? (
        <p className="text-xs text-muted-foreground">
          Reopened by you. Saving does not resume the agent. Use Show secure reference after saving.
        </p>
      ) : null}
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            id={inputId}
            // Password fields prompt to save credentials; this secret is not a login.
            type="text"
            className="[-webkit-text-security:disc]"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            placeholder={item.placeholder ?? SECRET_REQUEST_DEFAULT_PLACEHOLDER}
            value={secret}
            disabled={submitting || !canAnswer}
            aria-invalid={error !== null || undefined}
            aria-describedby={error !== null ? `${privacyId} ${errorId}` : privacyId}
            onChange={(event) => setSecret(event.currentTarget.value)}
          />
        </div>
        <Button type="submit" disabled={submitting || !canAnswer || secret.trim().length === 0}>
          Save securely
        </Button>
      </div>
      {error !== null ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p
          id={privacyId}
          className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
        >
          <ShieldCheckIcon className="size-3.5 shrink-0" aria-hidden />
          {secretRequestPrivacyNote(item)}
        </p>
        <Button
          type="button"
          size="xs"
          variant="ghost-muted"
          disabled={submitting || !canAnswer}
          onClick={() => void send({ type: "decline" })}
        >
          Decline
        </Button>
      </div>
    </form>
  );
}
