import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { AiAssistant } from "@/components/ai/ai-assistant";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { requireUser } from "@/lib/auth/session";

// The shell reads the session, so the whole authenticated subtree renders per
// request instead of prerendering a static shell (cacheComponents is enabled).
export const instant = false;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  // Restore the sidebar's open/collapsed state from its cookie (set client-side).
  // Absent on first visit, in which case we default to open.
  const sidebarState = (await cookies()).get("sidebar_state")?.value;
  const defaultOpen = sidebarState !== "false";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar user={user} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <span aria-hidden className="h-4 w-px bg-border" />
          <span className="text-sm font-medium">Apex Intake Desk</span>
          <AiAssistant />
        </header>
        <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
