"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronsUpDown,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Settings,
  UserRound,
  Users,
} from "lucide-react";
import { logout } from "@/lib/auth/actions";
import type { AuthUser } from "@/lib/auth/session";
import { initials } from "@/lib/format";
import { USER_ROLE_LABELS } from "@/lib/labels";
import { can, type Permission } from "@/lib/rbac";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  {
    title: "Overview",
    url: "/dashboard",
    icon: LayoutDashboard,
    permission: null,
  },
  { title: "Leads", url: "/leads", icon: ClipboardList, permission: null },
  { title: "Users", url: "/users", icon: Users, permission: "users.manage" },
];

/**
 * Account destinations, shown in the menu that opens above the profile button.
 *
 * They are about *you* rather than about the desk's work, which is why they hang
 * off the account menu instead of sitting in the workspace list beside Leads.
 */
const ACCOUNT_ITEMS: ReadonlyArray<{
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  permission: Permission | null;
}> = [
  { title: "Profile", url: "/profile", icon: UserRound, permission: null },
  // Everyone manages their own access tokens, so this is not permission-gated.
  { title: "Settings", url: "/settings", icon: Settings, permission: null },
];

export function AppSidebar({ user }: { user: AuthUser }) {
  const pathname = usePathname();

  const isCurrent = (url: string) =>
    pathname === url || pathname.startsWith(`${url}/`);

  const visible = <T extends { permission: Permission | null }>(
    items: ReadonlyArray<T>,
  ) =>
    items.filter(
      (item) => item.permission === null || can(user.role, item.permission),
    );

  const navItems = visible(NAV_ITEMS);
  const accountItems = visible(ACCOUNT_ITEMS);

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
              {navItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    isActive={isCurrent(item.url)}
                    tooltip={item.title}
                    render={<Link href={item.url} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                // The trigger *is* the profile row: clicking your own name opens
                // your account menu rather than navigating somewhere on its own.
                render={
                  <SidebarMenuButton
                    size="lg"
                    tooltip={user.name}
                    className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
                  />
                }
              >
                <Avatar className="size-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">
                    {initials(user.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  {/* The role, not the email: the email is long enough to be
                      truncated to nothing in a narrow sidebar, and who you are
                      in the desk is what matters here. */}
                  <span className="truncate text-xs text-muted-foreground">
                    {USER_ROLE_LABELS[user.role]}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
              </DropdownMenuTrigger>

              <DropdownMenuContent
                // Opens upward from the footer. `--anchor-width` matches the
                // sidebar when it is open; in the collapsed rail the trigger is
                // an icon button, so the menu falls back to its minimum width
                // rather than collapsing to 32px.
                side="top"
                align="start"
                sideOffset={6}
                className="w-(--anchor-width) min-w-56"
              >
                {/* Base UI requires a group around every label and its items
                    (`MenuGroupContext is missing` otherwise). */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="flex items-center gap-2">
                    <Avatar className="size-6 rounded-md">
                      <AvatarFallback className="rounded-md text-xs">
                        {initials(user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="grid min-w-0 leading-tight">
                      <span className="truncate font-medium">{user.name}</span>
                      {/* The full email belongs here, where there is room. */}
                      <span className="truncate text-xs font-normal text-muted-foreground">
                        {user.email}
                      </span>
                    </span>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />

                <DropdownMenuGroup>
                  {accountItems.map((item) => (
                    <DropdownMenuItem
                      key={item.url}
                      render={<Link href={item.url} />}
                    >
                      <item.icon />
                      {item.title}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>

                <DropdownMenuSeparator />
                {/* Logging out is a POST, so it stays a form submission rather
                    than a link that could be prefetched or followed. */}
                <form action={logout}>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      variant="destructive"
                      // The wrapper already sets `nativeButton={false}` (the
                      // other items render anchors); this one really is a
                      // button, so it has to say so or Base UI warns.
                      nativeButton
                      render={<button type="submit" className="w-full" />}
                    >
                      <LogOut />
                      Log out
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
