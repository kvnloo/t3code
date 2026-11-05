import { createRequire } from "node:module";
import { describe, expect, it } from "vite-plus/test";

const { addMailtoSendtoQuery } = createRequire(import.meta.url)("./withAndroidMailtoQueries.cjs") as {
  addMailtoSendtoQuery(manifest: { queries?: Array<Record<string, unknown>> }): void;
};

const emailQuery = {
  intent: [
    {
      action: [{ $: { "android:name": "android.intent.action.SENDTO" } }],
      data: [{ $: { "android:scheme": "mailto" } }],
    },
  ],
};

describe("Android email package visibility", () => {
  it("adds the mailto SENDTO query to the generated manifest", () => {
    const manifest: { queries?: Array<Record<string, unknown>> } = {};
    addMailtoSendtoQuery(manifest);
    expect(manifest.queries).toEqual([emailQuery]);
  });

  it("preserves existing queries and does not duplicate the mailto entry", () => {
    const existing = { package: [{ $: { "android:name": "com.example.mail" } }] };
    const manifest: { queries?: Array<Record<string, unknown>> } = {
      queries: [existing],
    };
    addMailtoSendtoQuery(manifest);
    addMailtoSendtoQuery(manifest);
    expect(manifest.queries).toEqual([existing, emailQuery]);
  });
});
