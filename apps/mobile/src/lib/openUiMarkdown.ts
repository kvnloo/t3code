export type OpenUiMarkdownPart =
  | { kind: "markdown"; text: string }
  | { kind: "report"; code: string };

/** Recognize completed versioned fences without interpreting surrounding code blocks. */
export function splitOpenUiMarkdown(markdown: string): OpenUiMarkdownPart[] {
  const parts: OpenUiMarkdownPart[] = [];
  const lines = markdown.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let pending = "";
  let block = "";
  let fence: { marker: string; length: number; report: boolean } | undefined;
  for (const line of lines) {
    const opening = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)/.exec(line);
    if (!fence && opening) {
      fence = { marker: opening[1]![0]!, length: opening[1]!.length, report: opening[2]!.trim() === "openui-v1" };
      block = line;
      continue;
    }
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*(?:\r?\n)?$/.exec(line);
      if (closing && closing[1]![0] === fence.marker && closing[1]!.length >= fence.length) {
        if (fence.report) {
          if (pending) parts.push({ kind: "markdown", text: pending });
          parts.push({ kind: "report", code: block.slice(block.indexOf("\n") + 1).replace(/\r?\n$/, "") });
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
