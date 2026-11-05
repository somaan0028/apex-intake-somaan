/**
 * The inline script that runs before React and before first paint inside the
 * authenticated app shell.
 *
 * It is rendered by `app/(app)/layout.tsx`, not the root layout, so public
 * pages (intake form, login) always keep the default light palette. The theme
 * and mode are known on the server from the signed-in user's preferences, so
 * they are embedded directly instead of being read from a cookie.
 *
 * A `system` mode also installs a media-query listener so the app follows the
 * OS while it is open.
 */
import { THEME_MODES, type ThemeMode } from "@/lib/preferences/types";
import { DEFAULT_THEME_ID, THEME_IDS, type ThemeId } from "./registry";

const allowedThemes = JSON.stringify(THEME_IDS);
const allowedModes = JSON.stringify(THEME_MODES);

/** Build the boot script for the signed-in user's saved appearance. */
export function buildThemeBootScript(theme: ThemeId, mode: ThemeMode): string {
  return `(function () {
  try {
    var allowedThemes = ${allowedThemes};
    var allowedModes = ${allowedModes};
    var theme = allowedThemes.indexOf(${JSON.stringify(theme)}) >= 0 ? ${JSON.stringify(theme)} : ${JSON.stringify(DEFAULT_THEME_ID)};
    var mode = allowedModes.indexOf(${JSON.stringify(mode)}) >= 0 ? ${JSON.stringify(mode)} : "light";
    var root = document.documentElement;
    var media = window.matchMedia("(prefers-color-scheme: dark)");

    function applyMode() {
      var currentMode = root.getAttribute("data-theme-mode") || mode;
      var dark = currentMode === "dark" || (currentMode === "system" && media.matches);
      root.classList.toggle("dark", dark);
      root.style.colorScheme = dark ? "dark" : "light";
    }

    root.setAttribute("data-theme", theme);
    root.setAttribute("data-theme-mode", mode);
    applyMode();

    if (mode === "system") {
      media.addEventListener("change", applyMode);
    }
  } catch (_) {
    // The CSS fallback in globals.css keeps the page usable if this fails.
  }
})();`;
}
