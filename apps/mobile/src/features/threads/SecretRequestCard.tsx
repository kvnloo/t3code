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
import { useRef, useState } from "react";
import { View, type ColorValue } from "react-native";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../../components/ui/Button";

const LOCK_SYMBOL: AppSymbolName = { ios: "lock", android: "lock" };
const PRIVATE_SYMBOL: AppSymbolName = { ios: "checkmark.shield", android: "lock" };

export function SecretRequestCard(props: {
  readonly environmentId: EnvironmentId;
  readonly projectedItem: OrchestrationV2ProjectedTurnItem;
  readonly iconColor: ColorValue;
}) {
  const { item, visibility } = props.projectedItem;
  if (item.type !== "secret_request") return null;
  const display = secretRequestDisplay(item, visibility);
  if (display.kind === "pending") {
    return (
      <PendingSecretRequestForm
        environmentId={props.environmentId}
        item={item}
        iconColor={props.iconColor}
      />
    );
  }
  const icon: AppSymbolName =
    display.kind === "pending-elsewhere"
      ? LOCK_SYMBOL
      : display.outcome === "saved"
        ? "checkmark"
        : "minus";
  return (
    <View className="mb-3 gap-2 px-1">
      <View className="min-h-9 flex-row items-center gap-2">
        <SymbolView name={icon} size={13} tintColor={props.iconColor} type="monochrome" />
        <Text className="flex-1 font-sans text-sm text-foreground-muted" numberOfLines={2}>
          {item.label} · {display.label}
        </Text>
      </View>
      {secretRequestCanReopen(item, visibility) ? (
        <SecretRequestRecovery environmentId={props.environmentId} item={item} />
      ) : null}
    </View>
  );
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
    <View className="gap-2">
      <Button
        label={busy ? "Opening…" : "Reopen secure prompt"}
        tone="text"
        disabled={busy || !canOperate}
        onPress={() => void send(false)}
      />
      {props.item.secretStatus === "saved" && props.item.parentItemId !== null ? (
        <Button
          label="Show secure reference"
          tone="text"
          disabled={busy || !canOperate}
          onPress={() => void send(true)}
        />
      ) : null}
      {result?.state === "pending" ? (
        <Text className="font-sans text-xs text-foreground-muted">
          Secure prompt reopened below. The agent has not been resumed.
        </Text>
      ) : null}
      {result?.state === "ended" ? (
        <Text className="font-sans text-xs text-foreground-muted">
          The reopened request ended. Reopen its card to try again.
        </Text>
      ) : null}
      {result?.state === "saved" ? (
        <Text selectable className="font-sans text-xs text-foreground-muted">
          Use this {result.delivery.type === "ref" ? "one-use reference" : "private file path"}{" "}
          instead of the secret:{" "}
          {result.delivery.type === "ref" ? result.delivery.ref : result.delivery.path}
        </Text>
      ) : null}
      {error !== null ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-danger-foreground">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function PendingSecretRequestForm(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SecretRequestItem;
  readonly iconColor: ColorValue;
}) {
  const { item } = props;
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
  // Submit then a tap can both run before a re-render; this guard is synchronous.
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

  return (
    <View className="mb-3 gap-3 rounded-[20px] border border-border bg-card-alt p-4">
      <View className="gap-1">
        <Text className="font-t3-bold text-base text-foreground">{item.label}</Text>
        {item.reason.trim() ? (
          <Text className="font-sans text-sm leading-5 text-foreground-muted" selectable>
            {item.reason}
          </Text>
        ) : null}
      </View>
      {item.parentItemId !== null ? (
        <Text className="font-sans text-xs text-foreground-muted">
          Reopened by you. Saving does not resume the agent. Use Show secure reference after saving.
        </Text>
      ) : null}
      <TextInput
        accessibilityLabel={item.label}
        placeholder={item.placeholder ?? SECRET_REQUEST_DEFAULT_PLACEHOLDER}
        value={secret}
        onChangeText={setSecret}
        editable={!submitting && canAnswer}
        secureTextEntry
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        textContentType="none"
        importantForAutofill="no"
        spellCheck={false}
        returnKeyType="done"
        onSubmitEditing={() => void send({ type: "save", secret })}
      />
      {error !== null ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          className="font-sans text-sm text-danger-foreground"
        >
          {error}
        </Text>
      ) : null}
      <Button
        label="Save securely"
        tone="primary"
        fullWidth
        disabled={submitting || !canAnswer || secret.trim().length === 0}
        onPress={() => void send({ type: "save", secret })}
      />
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-1 flex-row items-center gap-1.5">
          <SymbolView
            name={PRIVATE_SYMBOL}
            size={13}
            tintColor={props.iconColor}
            type="monochrome"
          />
          <Text className="flex-1 font-sans text-xs text-foreground-muted">
            {secretRequestPrivacyNote(item)}
          </Text>
        </View>
        <Button
          label="Decline"
          tone="text"
          disabled={submitting || !canAnswer}
          onPress={() => void send({ type: "decline" })}
        />
      </View>
    </View>
  );
}
