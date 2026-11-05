import type { ThreadPriorityTier } from "@t3tools/client-runtime/state/thread-priority";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const TIER_CLASS_NAME: Record<ThreadPriorityTier, string> = {
  1: "bg-warning/16 text-warning-foreground",
  2: "bg-info/14 text-info-foreground",
  3: "bg-sidebar-row-hover text-secondary-label",
  4: "text-secondary-label/70",
};

/**
 * The attention score a row or project folder sorts by while the sidebar orders by priority.
 * Its hundreds digit is the tier (4xx needs you, 3xx review, 2xx in progress, 1xx quiet);
 * the tooltip names the tier and the signals behind the score.
 */
export const SidebarPriorityBadge = memo(function SidebarPriorityBadge(props: {
  score: number;
  tier: ThreadPriorityTier;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={`Priority ${props.label}`}
            data-testid="sidebar-priority-badge"
            className={cn(
              "inline-flex h-4 shrink-0 items-center rounded-sm px-1 text-3xs leading-none font-medium tabular-nums",
              TIER_CLASS_NAME[props.tier],
            )}
          />
        }
      >
        {props.score}
      </TooltipTrigger>
      <TooltipPopup side="top">Priority {props.label}</TooltipPopup>
    </Tooltip>
  );
});
