/**
 * Runtime validation for the `users.preferences` JSON blob.
 *
 * Unknown keys are preserved by the writer (see `updateAppearance`) so a newer
 * preference cannot be dropped by an older code path. This reader only returns
 * the fields the current build understands, with safe defaults.
 */
import { z } from "zod";
import { DEFAULT_THEME_ID, THEME_IDS } from "@/lib/themes/registry";
import {
  DEFAULT_PREFERENCES,
  THEME_MODES,
  type UserPreferences,
} from "./types";

const appearanceSchema = z.object({
  theme: z.enum(THEME_IDS).catch(DEFAULT_THEME_ID),
  mode: z.enum(THEME_MODES).catch("system"),
});

const preferencesSchema = z.object({
  appearance: appearanceSchema.optional(),
});

/** Read a stored JSON value as typed preferences, falling back field by field. */
export function normalizePreferences(value: unknown): UserPreferences {
  const parsed = preferencesSchema.safeParse(value);
  if (!parsed.success) return DEFAULT_PREFERENCES;

  return {
    appearance: {
      theme: parsed.data.appearance?.theme ?? DEFAULT_THEME_ID,
      mode: parsed.data.appearance?.mode ?? "system",
    },
  };
}
