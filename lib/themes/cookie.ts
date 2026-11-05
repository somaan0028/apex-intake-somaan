/**
 * The small cookie that lets the very first paint use the right theme.
 *
 * It is readable by the boot script (so not `httpOnly`), but it contains only a
 * theme ID and a colour mode. The database remains the source of truth; login
 * and every appearance change rewrite this cookie.
 */
import { cookies } from "next/headers";
import { secureCookiesEnabled } from "@/lib/auth/session";
import type { ThemeMode } from "@/lib/preferences/types";
import type { ThemeId } from "./registry";

export const THEME_COOKIE = "apex-theme";

/** Keep the cache for a year; it is refreshed on every login. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** The cookie value: `<theme>:<mode>`. */
export function encodeThemeCookie(theme: ThemeId, mode: ThemeMode): string {
  return `${theme}:${mode}`;
}

/** Write the boot cookie for the signed-in user. */
export async function setThemeCookie(
  theme: ThemeId,
  mode: ThemeMode,
): Promise<void> {
  (await cookies()).set(THEME_COOKIE, encodeThemeCookie(theme, mode), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    secure: secureCookiesEnabled(),
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Remove the boot cookie on logout, so the next person sees the default. */
export async function clearThemeCookie(): Promise<void> {
  (await cookies()).delete(THEME_COOKIE);
}
