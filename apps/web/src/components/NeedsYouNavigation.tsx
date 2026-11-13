import { useLocation, useNavigate } from "@tanstack/react-router";
import { InboxIcon } from "lucide-react";
import { useQuietThreadShells } from "../state/entities";
import { useNowMinute } from "../hooks/useNowMinute";
import { needsYouQueue } from "@t3tools/client-runtime/state/needs-you";
import { SidebarMenuButton, useSidebar } from "./ui/sidebar";

export function NeedsYouNavigation() {
  const threads = useQuietThreadShells();
  const now = useNowMinute();
  const count = needsYouQueue(threads, now).length;
  const navigate = useNavigate();
  const active = useLocation({ select: (location) => location.pathname === "/needs-you" });
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <div className="shrink-0 border-t p-2">
      <SidebarMenuButton
        isActive={active}
        onClick={() => {
          if (isMobile) setOpenMobile(false);
          void navigate({ to: "/needs-you" });
        }}
      >
        <InboxIcon />
        <span>Needs you</span>
        <span className="ml-auto tabular-nums text-muted-foreground">{count}</span>
      </SidebarMenuButton>
    </div>
  );
}
