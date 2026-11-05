/**
 * Client-side theme application.
 *
 * Used for the optimistic switch when a theme card is clicked. The same state
 * is later written to the database by the Server Action.
 */
import type { ThemeMode } from "@/lib/preferences/types";
import type { ThemeId } from "./registry";

/** Whether a mode should use the dark variable set right now. */
export function resolveDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Apply a theme and mode to `<html>` without a page reload. */
export function applyTheme(theme: ThemeId, mode: ThemeMode): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const dark = resolveDark(mode);
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-theme-mode", mode);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

/**
 * Remove the theme from `<html>`, restoring the default light palette.
 *
 * The authenticated layout calls this when it unmounts so a client-side
 * navigation to a public page (for example after logout) cannot leave the
 * shell's dark class or theme behind on the shared document element.
 */
export function clearTheme(): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.removeAttribute("data-theme");
  root.removeAttribute("data-theme-mode");
  root.classList.remove("dark");
  root.style.removeProperty("color-scheme");
}
