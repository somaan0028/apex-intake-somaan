/**
 * The shape inside `users.preferences`.
 *
 * The column is a JSON object rather than a set of columns so new personal
 * settings (for example which Overview stats to show) can be added without a
 * migration. `normalizePreferences` is the only reader: it fills defaults and
 * drops values this build no longer understands.
 */
import { DEFAULT_THEME_ID, type ThemeId } from "@/lib/themes/registry";

export const THEME_MODES = ["light", "dark", "system"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

export interface AppearancePreferences {
  theme: ThemeId;
  mode: ThemeMode;
}

export interface UserPreferences {
  appearance: AppearancePreferences;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  appearance: {
    theme: DEFAULT_THEME_ID,
    mode: "light",
  },
};

/** Whether `value` is a supported colour mode. */
export function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === "string" &&
    (THEME_MODES as readonly string[]).includes(value)
  );
}
