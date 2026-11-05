/**
 * Client-side theme application.
 *
 * Used for the optimistic switch when a theme card is clicked. The same state
 * is later written to the database and the boot cookie by the Server Action.
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
