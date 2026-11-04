"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, LayoutDashboard, LogOut, Settings, Users } from "lucide-react";
import { logout } from "@/lib/auth/actions";
import type { AuthUser } from "@/lib/auth/session";
import { initials } from "@/lib/format";
import { can, type Permission } from "@/lib/rbac";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

/**
 * Primary navigation. `/dashboard` is the Overview tab.
 *
 * An item may declare the `permission` it needs; items the current role lacks
 * are hidden. This is presentation only — the page behind each link re-checks
 * the same policy on the server (see `app/(app)/users/page.tsx`).
 */
const NAV_ITEMS: ReadonlyArray<{
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  permission: Permission | null;
}> = [
  { title: "Overview", url: "/dashboard", icon: LayoutDashboard, permission: null },
  { title: "Leads", url: "/leads", icon: ClipboardList, permission: null },
  { title: "Users", url: "/users", icon: Users, permission: "users.manage" },
  // Everyone manages their own access tokens, so this is not permission-gated.
  { title: "Settings", url: "/settings", icon: Settings, permission: null },
];

export function AppSidebar({ user }: { user: AuthUser }) {
  const pathname = usePathname();

  const navItems = NAV_ITEMS.filter(
    (item) => item.permission === null || can(user.role, item.permission),
  );

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/dashboard" />}>
              <div className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
                <LayoutDashboard className="size-4" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-medium">Apex Intake Desk</span>
                <span className="truncate text-xs text-muted-foreground">
                  Lead intake &amp; delivery
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  pathname === item.url || pathname.startsWith(`${item.url}/`);
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={item.title}
                      render={<Link href={item.url} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip={user.email}
              render={<Link href="/dashboard" />}
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg">
                  {initials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <form action={logout}>
              <SidebarMenuButton type="submit" tooltip="Log out">
                <LogOut />
                <span>Log out</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
