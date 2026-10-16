/**
 * Human-readable, read-only status from the SAME permission-filtered, live
 * projection that powers the opt-in Android assistant attention queue.
 * No RPC, transcript, or model call is allowed at this presentation boundary.
 */
import type { AssistantAttentionSnapshot } from "./attentionSnapshot";

export type AssistantAttentionDigest = {
  readonly state: "unavailable" | "clear" | "pending";
  readonly title: string;
  readonly detail: string;
};

function count(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatAssistantAttentionDigest(
  snapshot: AssistantAttentionSnapshot,
): AssistantAttentionDigest {
  if (snapshot.liveEnvironmentCount === 0) {
    return {
      state: "unavailable",
      title: "Attention unavailable",
      detail: "No live T3 environments. Reconnect to check for pending approvals or blockers.",
    };
  }

  const { approval, question, plan, failed, working } = snapshot.counts;
  const needsMe = approval + question + plan + failed;
  const scope = count(snapshot.liveEnvironmentCount, "live environment");
  if (needsMe === 0) {
    return {
      state: "clear",
      title: "No pending attention",
      detail: `${scope} checked · ${count(working, "working thread")}`,
    };
  }
  const reasons = [
    approval > 0 ? count(approval, "approval") : null,
    question > 0 ? count(question, "answer") : null,
    plan > 0 ? count(plan, "plan review") : null,
    failed > 0 ? count(failed, "failed thread") : null,
  ].filter((value): value is string => value !== null);
  return {
    state: "pending",
    title: `${count(needsMe, "thread")} ${needsMe === 1 ? "needs" : "need"} attention`,
    detail: `${reasons.join(" · ")} · ${scope}`,
  };
}
