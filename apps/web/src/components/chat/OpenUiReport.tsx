import { createLibrary, defineComponent, Renderer } from "@openuidev/react-lang";
import { createParser } from "@openuidev/lang-core";
import { z } from "zod/v4";

const reportProps = z.object({
  title: z.string().max(200),
  summary: z.string().max(4000),
  metrics: z.array(z.object({ label: z.string().max(100), value: z.string().max(200) })).max(12),
  columns: z.array(z.string().max(100)).max(12),
  rows: z.array(z.array(z.string().max(2000)).max(12)).max(200),
  bars: z.array(z.object({ label: z.string().max(100), value: z.number().min(0).max(100) })).max(20),
});

const Report = defineComponent({
  name: "Report",
  description: "Read-only report. Table rows must match column count. Bars are percentages from 0 to 100. Use empty arrays for unused sections.",
  props: reportProps,
  component: ({ props }) => (
    <section aria-label={props.title} className="min-w-0 space-y-4 p-4 text-sm">
      <header>
        <h3 className="font-semibold">{props.title}</h3>
        <p className="whitespace-pre-wrap text-muted-foreground">{props.summary}</p>
      </header>
      {props.metrics.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {props.metrics.map((metric, index) => (
            <div key={index} className="min-w-0 rounded border border-border p-3 break-words">
              <dt className="text-muted-foreground">{metric.label}</dt>
              <dd className="font-mono text-lg">{metric.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {props.columns.length > 0 && (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${props.title} table`}>
          <table className="w-full border-collapse text-left">
            <thead><tr>{props.columns.map((column, index) => <th key={index} scope="col" className="border-b border-border p-2">{column}</th>)}</tr></thead>
            <tbody>{props.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column} className="border-b border-border p-2 whitespace-pre-wrap">{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {props.bars.length > 0 && <ul className="space-y-2" aria-label="Percentages">
        {props.bars.map((bar, index) => <li key={index}>
          <div className="flex justify-between gap-2"><span>{bar.label}</span><span>{bar.value}%</span></div>
          <meter className="h-3 w-full" min={0} max={100} value={bar.value} aria-label={bar.label}>{bar.value}%</meter>
        </li>)}
      </ul>}
    </section>
  ),
});

const library = createLibrary({ components: [Report], root: "Report" });

export const openUiReportPrompt = library.prompt({
  preamble: "Create a read-only T3 report using only supplied facts. Never invent measurements.",
  additionalRules: [
    "Return the program inside an openui-v1 fenced code block.",
    "Do not use Query, Mutation, actions, state, tools, URLs or functions.",
    "Use the six Report arguments in declared order. Table rows must match column count.",
    "Use empty arrays for unused sections. Percentages must be between 0 and 100.",
    "After the fenced block include a normal Markdown summary for clients without the renderer.",
  ],
  examples: ['root = Report("Test results", "Focused parser suite", [{label: "Passed", value: "12"}], ["Suite", "Result"], [["Parser", "pass"]], [{label: "Pass rate", value: 100}])'],
});

export function inspectOpenUiReport(code: string) {
  if (code.length > 65_536) return { kind: "invalid", reason: "Report exceeds the 64 KiB limit." } as const;
  try {
    const parsed = createParser(library.toJSONSchema(), library.root).parse(code);
    if (parsed.queryStatements.length || parsed.mutationStatements.length || Object.keys(parsed.stateDeclarations).length) {
      return { kind: "invalid", reason: "This catalog is read-only; tools and state are not supported." } as const;
    }
    if (parsed.meta.incomplete || parsed.meta.unresolved.length || !parsed.root) {
      return { kind: "incomplete", reason: "Report is incomplete. The original source remains available." } as const;
    }
    const props = reportProps.safeParse(parsed.root.props);
    if (parsed.meta.errors.length || parsed.root.typeName !== "Report" || !props.success || props.data.rows.some((row) => row.length !== props.data.columns.length)) {
      return { kind: "invalid", reason: "Report does not match catalog version 1." } as const;
    }
    return { kind: "ready" } as const;
  } catch {
    return { kind: "invalid", reason: "Report could not be parsed. The original source remains available." } as const;
  }
}

export function OpenUiReport({ code }: { code: string }) {
  const status = inspectOpenUiReport(code);
  if (status.kind !== "ready") return <p role="status" className="p-4 text-sm text-muted-foreground">{status.reason}</p>;
  // No tool provider, actions or state callbacks: generated content has no action authority.
  return <Renderer response={code} library={library} isStreaming={false} />;
}
