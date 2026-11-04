export type OpenUiMarkdownPart =
  | { kind: "markdown"; text: string }
  | { kind: "report"; version: 1 | 2; code: string };

/** Versioned fences: v1 is the Report catalog, v2 the chart board catalog. */
const REPORT_VERSIONS: Readonly<Record<string, 1 | 2>> = { "openui-v1": 1, "openui-v2": 2 };

/** Recognize completed versioned fences without interpreting surrounding code blocks. */
export function splitOpenUiMarkdown(markdown: string): OpenUiMarkdownPart[] {
  const parts: OpenUiMarkdownPart[] = [];
  const lines = markdown.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let pending = "";
  let block = "";
  let fence: { marker: string; length: number; version: 1 | 2 | undefined } | undefined;
  for (const line of lines) {
    const opening = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)/.exec(line);
    if (!fence && opening) {
      fence = { marker: opening[1]![0]!, length: opening[1]!.length, version: REPORT_VERSIONS[opening[2]!.trim()] };
      block = line;
      continue;
    }
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*(?:\r?\n)?$/.exec(line);
      if (closing && closing[1]![0] === fence.marker && closing[1]!.length >= fence.length) {
        if (fence.version) {
          if (pending) parts.push({ kind: "markdown", text: pending });
          parts.push({ kind: "report", version: fence.version, code: block.slice(block.indexOf("\n") + 1).replace(/\r?\n$/, "") });
          pending = "";
        } else pending += block + line;
        block = "";
        fence = undefined;
      } else block += line;
    } else pending += line;
  }
  pending += block;
  if (pending) parts.push({ kind: "markdown", text: pending });
  return parts;
}
