import * as Schema from "effect/Schema";
import { Linking, Platform } from "react-native";

import { openEmailDraft } from "../native/openEmailDraft";

const ExternalUrlTarget = Schema.Literals([
  "file-preview",
  "markdown-link",
  "pull-request",
  "provider-auth",
  "html-render",
  "mcp-app",
]);

export type ExternalUrlTarget = typeof ExternalUrlTarget.Type;

export class ExternalUrlOpenError extends Schema.TaggedError<ExternalUrlOpenError>()(
  "ExternalUrlOpenError",
  {
    target: ExternalUrlTarget,
    scheme: Schema.String,
    host: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to open ${this.target} URL with the ${this.scheme} scheme.`;
  }
}

export interface MailtoDraft {
  readonly to: ReadonlyArray<string>;
  readonly cc: ReadonlyArray<string>;
  readonly bcc: ReadonlyArray<string>;
  readonly subject: string;
  readonly body: string;
}

function emailAddresses(value: string): string[] {
  return value
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
}

export function parseMailtoDraftUrl(href: string): MailtoDraft | null {
  if (!/^mailto:/i.test(href)) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== "mailto:") return null;
    return {
      to: [
        ...emailAddresses(decodeURIComponent(url.pathname)),
        ...url.searchParams.getAll("to").flatMap(emailAddresses),
      ],
      cc: url.searchParams.getAll("cc").flatMap(emailAddresses),
      bcc: url.searchParams.getAll("bcc").flatMap(emailAddresses),
      subject: url.searchParams.get("subject") ?? "",
      body: url.searchParams.get("body") ?? "",
    };
  } catch {
    return null;
  }
}

function externalUrlMetadata(url: string): { readonly scheme: string; readonly host?: string } {
  try {
    const parsed = new URL(url);
    return {
      scheme: parsed.protocol.replace(/:$/, "") || "unknown",
      host: parsed.hostname || undefined,
    };
  } catch {
    return {
      scheme: /^([a-z][a-z\d+.-]*):/i.exec(url)?.[1]?.toLowerCase() ?? "unknown",
    };
  }
}

export async function tryOpenExternalUrl(url: string, target: ExternalUrlTarget): Promise<boolean> {
  const chatLink = target === "markdown-link" || target === "pull-request";
  if (chatLink && /^(?:javascript|file|data|content|intent):/i.test(url.trim())) return false;
  try {
    const draft = chatLink && Platform.OS === "android" ? parseMailtoDraftUrl(url) : null;
    if (draft) await openEmailDraft(draft);
    else await Linking.openURL(url);
    return true;
  } catch (cause) {
    const error = new ExternalUrlOpenError({ target, ...externalUrlMetadata(url), cause });
    console.error(error.message, {
      _tag: error._tag,
      target: error.target,
      scheme: error.scheme,
      host: error.host,
      stack: error.stack,
    });
    return false;
  }
}
