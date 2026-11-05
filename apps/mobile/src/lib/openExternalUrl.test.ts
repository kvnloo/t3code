import { Linking } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { openEmailDraft } from "../native/openEmailDraft";
import { parseMailtoDraftUrl, tryOpenExternalUrl } from "./openExternalUrl";

vi.mock("react-native", () => ({
  Linking: { openURL: vi.fn() },
  Platform: { OS: "android" },
}));
vi.mock("../native/openEmailDraft", () => ({
  openEmailDraft: vi.fn(),
}));

const openURL = vi.mocked(Linking.openURL);
const openEmail = vi.mocked(openEmailDraft);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tryOpenExternalUrl", () => {
  it("keeps provider sign-in URLs unchanged and out of failure logs", async () => {
    const url =
      "https://accounts.google.com/o/oauth2/v2/auth?state=private-state&code_challenge=private-challenge&redirect_uri=http%3A%2F%2F127.0.0.1%3A43123%2F";
    openURL.mockRejectedValue(new Error(`Cannot open ${url}`));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(tryOpenExternalUrl(url, "provider-auth")).resolves.toBe(false);

    expect(openURL).toHaveBeenCalledWith(url);
    const diagnostics = JSON.stringify(consoleError.mock.calls);
    expect(diagnostics).toContain("accounts.google.com");
    expect(diagnostics).not.toContain("private-state");
    expect(diagnostics).not.toContain("private-challenge");
    expect(diagnostics).not.toContain("43123");
  });
});

describe("Android email drafts", () => {
  const href =
    "mailto:first%40example.com,second@example.com?to=third%40example.com&cc=copy%40example.com&bcc=hidden%40example.com&subject=Hello%20%26%20Thanks&body=Line%201%0ALine%202";

  it("decodes to, cc, subject and body without losing encoded characters", () => {
    expect(parseMailtoDraftUrl(href)).toEqual({
      to: ["first@example.com", "second@example.com", "third@example.com"],
      cc: ["copy@example.com"],
      bcc: ["hidden@example.com"],
      subject: "Hello & Thanks",
      body: "Line 1\nLine 2",
    });
  });

  it("opens the email composer rather than the generic ACTION_VIEW link path", async () => {
    openEmail.mockResolvedValue(undefined);

    await expect(tryOpenExternalUrl(href, "pull-request")).resolves.toBe(true);

    expect(openEmail).toHaveBeenCalledWith({
      to: ["first@example.com", "second@example.com", "third@example.com"],
      cc: ["copy@example.com"],
      bcc: ["hidden@example.com"],
      subject: "Hello & Thanks",
      body: "Line 1\nLine 2",
    });
    expect(openURL).not.toHaveBeenCalled();
  });

  it("decodes unicode, plus signs, ampersands and line breaks from mailto fields", () => {
    expect(parseMailtoDraftUrl("mailto:alice%2Balerts%40example.com?cc=team%2Bops%40example.com&subject=R%C3%A9sum%C3%A9%20%2B%20Roadmap%20%26%20Notes&body=Line%201%0ALine%202%20%2B%20caf%C3%A9%20%26%20tea")).toEqual({
      to: ["alice+alerts@example.com"],
      cc: ["team+ops@example.com"],
      bcc: [],
      subject: "Résumé + Roadmap & Notes",
      body: "Line 1\\nLine 2 + café & tea",
    });
  });

  it.each(["markdown-link", "pull-request", "file-preview", "html-render", "mcp-app"] as const)(
    "opens %s mailto links in the Android email composer",
    async (target) => {
      openEmail.mockResolvedValue(undefined);

      await expect(tryOpenExternalUrl("mailto:alice%2Balerts%40example.com?cc=team%2Bops%40example.com&subject=R%C3%A9sum%C3%A9%20%2B%20Roadmap%20%26%20Notes&body=Line%201%0ALine%202%20%2B%20caf%C3%A9%20%26%20tea", target)).resolves.toBe(true);

      expect(openEmail).toHaveBeenCalledWith({
        to: ["alice+alerts@example.com"],
        cc: ["team+ops@example.com"],
        bcc: [],
        subject: "Résumé + Roadmap & Notes",
        body: "Line 1\\nLine 2 + café & tea",
      });
      expect(openURL).not.toHaveBeenCalled();
    },
  );

  it("accepts a mailto link without recipients for a blank draft", () => {
    expect(parseMailtoDraftUrl("mailto:?subject=Follow%20up")).toEqual({
      to: [],
      cc: [],
      bcc: [],
      subject: "Follow up",
      body: "",
    });
  });

  it.each(["javascript:alert(1)", "file:///sdcard/private.txt", "data:text/html,unsafe"])(
    "blocks unsafe chat schemes without launching another app: %s",
    async (href) => {
      expect(parseMailtoDraftUrl(href)).toBeNull();
      await expect(tryOpenExternalUrl(href, "pull-request")).resolves.toBe(false);
      expect(openURL).not.toHaveBeenCalled();
      expect(openEmail).not.toHaveBeenCalled();
    },
  );
});
