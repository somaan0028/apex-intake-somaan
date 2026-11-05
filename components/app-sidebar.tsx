"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import {
  Activity,
  Bot,
  Briefcase,
  ChartColumn,
  ChevronDown,
  ChevronsUpDown,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Settings,
  SlidersHorizontal,
  UserRound,
  Users,
} from "lucide-react";
import { ApexMark } from "@/components/apex-mark";
import { logout } from "@/lib/auth/actions";
import type { AuthUser } from "@/lib/auth/session";
import { USER_ROLE_LABELS } from "@/lib/labels";
import { can, type Permission } from "@/lib/rbac";
import { UserAvatar } from "@/components/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";

/** One navigation destination. */
type NavItem = {
  title: string;
  url: string;
  /** Where the link actually points, when it needs a query string. */
  href?: string;
  icon: typeof LayoutDashboard;
  permission: Permission | null;
};

/** A collapsible parent in the sidebar. */
type NavGroup = {
  title: string;
  icon: typeof LayoutDashboard;
  items: ReadonlyArray<NavItem>;
};

/**
 * Primary navigation. `/dashboard` is the Overview tab.
 *
 * An item may declare the `permission` it needs; items the current role lacks
 * are hidden. This is presentation only — the page behind each link re-checks
 * the same policy on the server (see `app/(app)/users/page.tsx`).
 */
const NAV_ITEMS: ReadonlyArray<NavItem> = [
  {
    title: "Overview",
    url: "/dashboard",
    icon: LayoutDashboard,
    permission: null,
  },
  {
    title: "Leads",
    url: "/leads",
    // Coming back to the desk should resume the filters this browser last used;
    // a plain `/leads` landing (a shared link, a redirect) starts cleared.
    href: "/leads?preserveFilters=true",
    icon: ClipboardList,
    permission: null,
  },
  {
    title: "Analytics",
    url: "/analytics",
    icon: ChartColumn,
    permission: "analytics.view",
  },
];

/**
 * The remaining destinations are grouped by what they are about: the people and
 * audit trail behind the desk, then the account's own settings.
 */
const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  {
    title: "Staff",
    icon: Briefcase,
    items: [
      {
        title: "Users",
        url: "/users",
        icon: Users,
        permission: "users.manage",
      },
      { title: "Activity", url: "/activity", icon: Activity, permission: null },
    ],
  },
  {
    title: "Settings",
    icon: Settings,
    items: [
      {
        title: "Connect Your Agent",
        url: "/settings/ai",
        icon: Bot,
        permission: null,
      },
      {
        title: "Preferences",
        url: "/settings/preferences",
        icon: SlidersHorizontal,
        permission: null,
      },
    ],
  },
];

/**
 * Account destinations, shown in the menu that opens above the profile button.
 *
 * They are about *you* rather than about the desk's work, which is why they hang
 * off the account menu instead of sitting in the workspace list beside Leads.
 */
const ACCOUNT_ITEMS: ReadonlyArray<NavItem> = [
  { title: "Profile", url: "/profile", icon: UserRound, permission: null },
];

export function AppSidebar({ user }: { user: AuthUser }) {
  const pathname = usePathname();
  const { state, setOpen } = useSidebar();
  // Groups start open. A missing key means "open", so the map only records the
  // groups the person has explicitly folded.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const isCurrent = (url: string) =>
    pathname === url || pathname.startsWith(`${url}/`);

  const visible = <T extends { permission: Permission | null }>(
    items: ReadonlyArray<T>,
  ) =>
    items.filter(
      (item) => item.permission === null || can(user.role, item.permission),
    );

  const navItems = visible(NAV_ITEMS);
  const navGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: visible(group.items),
  })).filter((group) => group.items.length > 0);
  const accountItems = visible(ACCOUNT_ITEMS);

  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/dashboard" />}>
              <div className="flex size-8 items-center justify-center rounded-md bg-black text-white dark:bg-white dark:text-black">
                <ApexMark className="size-6" />
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
            <SidebarMenu className="gap-0.5">
              {navItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    isActive={isCurrent(item.url)}
                    tooltip={item.title}
                    render={<Link href={item.href ?? item.url} />}
                  >
                    <item.icon className="text-sidebar-accent-foreground" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              {navGroups.map((group) => (
                <Collapsible.Root
                  key={group.title}
                  render={<SidebarMenuItem />}
                  open={openGroups[group.title] ?? true}
                  onOpenChange={(open) => {
                    // In the icon rail the submenu is hidden, so a click is a
                    // request to reopen the sidebar; keep the group expanded
                    // for when it appears.
                    if (state === "collapsed") {
                      setOpen(true);
                      setOpenGroups((previous) => ({
                        ...previous,
                        [group.title]: true,
                      }));
                      return;
                    }
                    setOpenGroups((previous) => ({
                      ...previous,
                      [group.title]: open,
                    }));
                  }}
                >
                  <Collapsible.Trigger
                    render={
                      <SidebarMenuButton
                        tooltip={group.title}
                        isActive={group.items.some((item) =>
                          isCurrent(item.url),
                        )}
                      />
                    }
                  >
                    <group.icon className="text-sidebar-accent-foreground" />
                    <span>{group.title}</span>
                    <ChevronDown className="ml-auto size-4 shrink-0 transition-transform group-data-[panel-open]/menu-button:rotate-180" />
                  </Collapsible.Trigger>

                  <Collapsible.Panel>
                    <SidebarMenuSub>
                      {group.items.map((item) => (
                        <SidebarMenuSubItem key={item.url}>
                          <SidebarMenuSubButton
                            isActive={isCurrent(item.url)}
                            render={<Link href={item.url} />}
                          >
                            <item.icon className="text-sidebar-accent-foreground" />
                            <span>{item.title}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </Collapsible.Panel>
                </Collapsible.Root>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="pt-1">
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
                    className="border border-sidebar-border data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
                  />
                }
              >
                <UserAvatar
                  userId={user.id}
                  name={user.name}
                  avatarPath={user.avatarPath}
                  className="size-8 rounded-lg"
                  fallbackClassName="rounded-lg"
                />
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
