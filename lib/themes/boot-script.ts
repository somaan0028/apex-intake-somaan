/**
 * The inline script that runs before React and before first paint.
 *
 * It reads the theme cookie, validates it against the IDs this build knows, and
 * applies `data-theme` plus the `dark` class to `<html>`. A `system` mode also
 * installs a media-query listener so the app follows the OS while it is open.
 */
import { THEME_IDS, DEFAULT_THEME_ID } from "./registry";
import { THEME_MODES } from "@/lib/preferences/types";

const allowedThemes = JSON.stringify(THEME_IDS);
const allowedModes = JSON.stringify(THEME_MODES);
const defaultTheme = JSON.stringify(DEFAULT_THEME_ID);

export const THEME_BOOT_SCRIPT = `(function () {
  try {
    var allowedThemes = ${allowedThemes};
    var allowedModes = ${allowedModes};
    var match = document.cookie.match(/(?:^|; )apex-theme=([^;]+)/);
    var raw = match ? decodeURIComponent(match[1]) : "";
    var parts = raw.split(":");
    var theme = allowedThemes.indexOf(parts[0]) >= 0 ? parts[0] : ${defaultTheme};
    var mode = allowedModes.indexOf(parts[1]) >= 0 ? parts[1] : "system";
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
