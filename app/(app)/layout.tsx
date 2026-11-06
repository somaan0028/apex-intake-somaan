import type { ReactNode } from "react";
import { cookies } from "next/headers";
import {
  AiAssistantButton,
  AiAssistantProvider,
} from "@/components/ai/ai-assistant";
import { AppSidebar } from "@/components/app-sidebar";
import { InlineScript } from "@/components/inline-script";
import { ThemeScope } from "@/components/theme-scope";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { requireUser } from "@/lib/auth/session";
import { getUserPreferences } from "@/lib/preferences/queries";
import { toggleSidebarPinned } from "@/lib/sidebar/actions";
import { buildThemeBootScript } from "@/lib/themes/boot-script";

// The shell reads the session, so the whole authenticated subtree renders per
// request instead of prerendering a static shell (cacheComponents is enabled).
export const instant = false;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  // Restore the sidebar's open/collapsed state from its cookie (set client-side).
  // Absent on first visit, in which case we default to open.
  const sidebarState = (await cookies()).get("sidebar_state")?.value;
  const defaultOpen = sidebarState !== "false";

  // Appearance is scoped to the authenticated shell: the boot script below and
  // `ThemeScope` apply it to `<html>`, and the root layout stays untouched so
  // public pages (intake form, login) always use the light default.
  const appearance = getUserPreferences(user.id).appearance;

  return (
    <>
      <InlineScript
        id="apex-theme-boot"
        html={buildThemeBootScript(appearance.theme, appearance.mode)}
      />
      <ThemeScope theme={appearance.theme} mode={appearance.mode} />
      <SidebarProvider defaultOpen={defaultOpen}>
        {/* Wraps the shell so any page inside it can ask the assistant to open
            (see `components/ai/assistant-context.tsx`); the panel itself lives
            here so it survives navigation between pages. */}
        <AiAssistantProvider>
          <AppSidebar user={user} />
          <SidebarInset className="md:peer-data-[variant=inset]:shadow-md">
            <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
              <SidebarTrigger
                className="-ml-1"
                action={toggleSidebarPinned}
              />
              <span aria-hidden className="h-4 w-px bg-border" />
              <span className="text-sm font-medium">Apex Intake Desk</span>
              <AiAssistantButton />
            </header>
            <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
              {children}
            </div>
          </SidebarInset>
        </AiAssistantProvider>
      </SidebarProvider>
    </>
  );
}
