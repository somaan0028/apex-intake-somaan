/**
 * The themes a user can choose between.
 *
 * IDs are persisted in `users.preferences` and in the boot cookie, so they are
 * stable slugs. The actual variable values live in `app/themes.css`; this module
 * is safe to import from Client Components because it contains only metadata.
 */
export const THEME_IDS = [
  "default",
  "sakura",
  "whatsapp",
  "retro",
  "zen",
  "claude",
  "bold-wikipedia",
  "burgundy",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME_ID: ThemeId = "default";

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  description: string;
}

export const THEMES: ReadonlyArray<ThemeDefinition> = [
  {
    id: "default",
    name: "Apex (Default)",
    description: "Warm sand and gold",
  },
  {
    id: "sakura",
    name: "Sakura",
    description: "Soft pink and blossom",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "Familiar green and white",
  },
  {
    id: "retro",
    name: "Retro",
    description: "Bold orange and vintage",
  },
  {
    id: "zen",
    name: "Zen",
    description: "Calm stone and vermilion",
  },
  {
    id: "claude",
    name: "Claude",
    description: "Warm paper and clay",
  },
  {
    id: "bold-wikipedia",
    name: "Bold Wikipedia",
    description: "Crisp blue and editorial",
  },
  {
    id: "burgundy",
    name: "Burgundy",
    description: "Deep wine and rose",
  },
];

/** Whether `value` is a theme this build knows how to render. */
export function isThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === "string" &&
    (THEME_IDS as readonly string[]).includes(value)
  );
}
