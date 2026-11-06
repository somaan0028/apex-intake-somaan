"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

/**
 * Pin or unpin the sidebar without JavaScript.
 *
 * The sidebar's collapse control is a button whose click handler can only
 * exist after hydration. The header renders it inside a form that points here,
 * so a click before the shell is interactive still works: the browser posts,
 * the cookie flips, and the layout comes back with the rail in the new state.
 * Once React is ready the trigger switches to `type="button"` and toggles
 * locally instead, so this only runs on the first paint.
 */
export async function toggleSidebarPinned(): Promise<void> {
  const store = await cookies();
  const collapsed = store.get("sidebar_state")?.value === "false";

  store.set("sidebar_state", collapsed ? "true" : "false", {
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    sameSite: "lax",
  });

  // The layout reads the cookie, so it has to be part of the response.
  revalidatePath("/", "layout");
}
