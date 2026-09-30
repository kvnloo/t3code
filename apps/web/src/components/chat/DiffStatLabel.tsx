import { memo } from "react";
import { cn } from "~/lib/utils";

export function hasNonZeroStat(stat: { additions: number; deletions: number }): boolean {
  return stat.additions > 0 || stat.deletions > 0;
}

const DIFF_COUNT_UNITS = [
  [1_000_000_000, "b"],
  [1_000_000, "m"],
  [1_000, "k"],
] as const;

function compactDiffCountText(value: number, scale: number): string {
  // Round the magnitude so a negative count mirrors its positive twin.
  const scaled = Math.abs(value) / scale;
  const text = scaled < 10 ? scaled.toFixed(1).replace(/\.0$/, "") : `${Math.round(scaled)}`;
  return value < 0 ? `-${text}` : text;
}

export function formatCompactDiffCount(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1000) return String(value);
  let larger: { scale: number; suffix: string } | undefined;
  for (const [scale, suffix] of DIFF_COUNT_UNITS) {
    if (abs >= scale) {
      const text = compactDiffCountText(value, scale);
      // Rounding can push the count into the next unit: 999.5k additions
      // read as "1m", not "1000k".
      if ((text === "1000" || text === "-1000") && larger !== undefined) {
        return `${compactDiffCountText(value, larger.scale)}${larger.suffix}`;
      }
      return `${text}${suffix}`;
    }
    larger = { scale, suffix };
  }
  return String(value);
}

export const DiffStatLabel = memo(function DiffStatLabel(props: {
  additions: number;
  deletions: number;
  className?: string;
  showParentheses?: boolean;
  layout?: "aligned" | "inline";
}) {
  const { additions, deletions, className, showParentheses = false, layout = "aligned" } = props;
  return (
    <>
      {showParentheses && <span className="text-muted-foreground/70">(</span>}
      <span
        role="group"
        aria-label={`${additions} additions, ${deletions} deletions`}
        className={cn(
          layout === "inline"
            ? "inline-flex items-center gap-1 tabular-nums align-middle"
            : "inline-grid grid-cols-[4ch_4ch] gap-2 text-right tabular-nums align-middle",
          className,
        )}
      >
        <span aria-hidden="true" className="font-mono text-diff-addition">
          +{formatCompactDiffCount(additions)}
        </span>
        <span aria-hidden="true" className="font-mono text-diff-deletion">
          -{formatCompactDiffCount(deletions)}
        </span>
      </span>
      {showParentheses && <span className="text-muted-foreground/70">)</span>}
    </>
  );
});
