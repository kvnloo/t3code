import { lazy, Suspense, useState } from "react";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { Button } from "../ui/button";

const Report = lazy(() => import("./OpenUiReport").then((module) => ({ default: module.OpenUiReport })));

/** The versioned fence stays in the normal transcript; rendering is explicitly opt-in. */
export function MarkdownOpenUiCodeBlock({ code, isStreaming }: { code: string; isStreaming: boolean }) {
  const [showReport, setShowReport] = useState(false);
  const source = <pre className="max-h-96 overflow-auto p-4 text-xs"><code>{code}</code></pre>;
  return (
    <div className="my-3 min-w-0 overflow-hidden rounded-lg border border-border bg-secondary/30" data-openui-catalog="1">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-xs text-muted-foreground">OpenUI Lab · read-only · {isStreaming ? "receiving" : "version 1"}</span>
        <Button size="sm" variant="outline" onClick={() => setShowReport((value) => !value)} aria-pressed={showReport}>
          {showReport ? "Show source" : "Render report"}
        </Button>
      </div>
      {showReport ? (
        <RenderErrorBoundary resetKeys={[code]} fallback={<><p role="alert" className="p-3 text-sm">Report unavailable. Original source:</p>{source}</>}>
          <Suspense fallback={<p role="status" className="p-4 text-sm">Loading report renderer…</p>}>
            <Report code={code} />
          </Suspense>
        </RenderErrorBoundary>
      ) : source}
    </div>
  );
}
