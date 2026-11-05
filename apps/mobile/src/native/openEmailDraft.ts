import { requireOptionalNativeModule } from "expo";

import type { MailtoDraft } from "../lib/openExternalUrl";

type NativeEmailDraftModule = {
  openEmailDraft(
    to: string[],
    cc: string[],
    bcc: string[],
    subject: string,
    body: string,
  ): Promise<void>;
};

export async function openEmailDraft(draft: MailtoDraft): Promise<void> {
  const native = requireOptionalNativeModule<NativeEmailDraftModule>("T3NativeControls");
  if (!native?.openEmailDraft) {
    throw new Error("The Android email composer requires a rebuilt T3 Code client.");
  }
  await native.openEmailDraft(
    [...draft.to],
    [...draft.cc],
    [...draft.bcc],
    draft.subject,
    draft.body,
  );
}
