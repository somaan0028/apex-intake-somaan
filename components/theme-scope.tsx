"use client";

/**
 * Keeps the signed-in user's theme applied to `<html>` while the app shell is
 * mounted, and removes it when the shell unmounts.
 *
 * The very first paint inside the app is handled by an inline boot script in
 * `app/(app)/layout.tsx`; this component covers the two cases that script
 * cannot: a soft navigation into the shell (login → dashboard, where an RSC
 * script tag does not execute) and leaving it (logout → login, where the root
 * document keeps its attributes unless we clean up).
 *
 * Public pages never render this, so they always use the default light palette.
 */
import { useEffect, useLayoutEffect } from "react";
import { applyTheme, clearTheme } from "@/lib/themes/apply";
import type { ThemeMode } from "@/lib/preferences/types";
import type { ThemeId } from "@/lib/themes/registry";

// The cleanup must run before the next route paints; `useLayoutEffect` is
// unavailable during server rendering, so fall back to `useEffect` there.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function ThemeScope({
  theme,
  mode,
}: {
  theme: ThemeId;
  mode: ThemeMode;
}) {
  useIsomorphicLayoutEffect(() => {
    applyTheme(theme, mode);

    const media =
      mode === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    const onChange = () => applyTheme(theme, mode);
    media?.addEventListener("change", onChange);

    return () => {
      media?.removeEventListener("change", onChange);
      clearTheme();
    };
  }, [theme, mode]);

  return null;
}
