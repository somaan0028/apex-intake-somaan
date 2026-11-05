"use client";

/**
 * Appearance settings: preset themes plus a light/dark/system mode.
 *
 * Selecting an option applies it to the document immediately and then saves it.
 * If the save fails, the previous choice is restored so the UI never claims a
 * preference that was not persisted.
 */
import { Check, Loader2, Monitor, Moon, Sun } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { updateAppearance } from "@/lib/preferences/actions";
import {
  type AppearancePreferences,
  type ThemeMode,
} from "@/lib/preferences/types";
import { applyTheme } from "@/lib/themes/apply";
import { THEMES, type ThemeId } from "@/lib/themes/registry";
import { cn } from "cn";

const MODE_OPTIONS: ReadonlyArray<{
  value: ThemeMode;
  label: string;
  icon: typeof Sun;
}> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function AppearanceSettings({
  initial,
}: {
  initial: AppearancePreferences;
}) {
  const [theme, setTheme] = useState<ThemeId>(initial.theme);
  const [mode, setMode] = useState<ThemeMode>(initial.mode);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Guards against an older save resolving after a newer one.
  const requestId = useRef(0);

  function save(nextTheme: ThemeId, nextMode: ThemeMode) {
    if (nextTheme === theme && nextMode === mode) return;

    const previous = { theme, mode };
    const request = ++requestId.current;

    setTheme(nextTheme);
    setMode(nextMode);
    setError(null);
    applyTheme(nextTheme, nextMode);

    startTransition(async () => {
      const result = await updateAppearance({
        theme: nextTheme,
        mode: nextMode,
      });

      if (request !== requestId.current) return;

      if (!result.ok) {
        setTheme(previous.theme);
        setMode(previous.mode);
        applyTheme(previous.theme, previous.mode);
        setError(result.error ?? "Could not save that change. Try again.");
      }
    });
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Theme</p>
            <p className="text-xs text-muted-foreground">
              Pick the palette used across the desk.
            </p>
          </div>
          {pending ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Saving…
            </span>
          ) : null}
        </div>

        <div
          role="radiogroup"
          aria-label="Theme"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          {THEMES.map((option) => {
            const selected = option.id === theme;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                data-theme={option.id}
                disabled={pending}
                onClick={() => save(option.id, mode)}
                className={cn(
                  "group relative overflow-hidden rounded-xl border border-border bg-background p-3 text-left text-foreground transition-shadow outline-none",
                  "hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait",
                  selected && "ring-2 ring-primary",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate text-sm font-medium">
                      {option.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                  {selected ? (
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3" />
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 rounded-lg border border-border bg-card p-2">
                  <div className="flex items-center gap-2">
                    <span className="size-5 rounded-full bg-primary" />
                    <span className="h-1.5 w-16 rounded-full bg-foreground/70" />
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <span className="h-8 w-10 rounded border border-sidebar-border bg-sidebar" />
                    <span className="h-8 flex-1 rounded bg-secondary" />
                    <span className="h-8 flex-1 rounded bg-muted" />
                    <span className="h-8 flex-1 rounded bg-accent" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2">
        <p className="text-sm font-medium">Colour mode</p>
        <p className="text-xs text-muted-foreground">
          Use a light or dark palette, or follow your system setting.
        </p>
        <div
          role="group"
          aria-label="Colour mode"
          className="mt-1 flex flex-wrap gap-2"
        >
          {MODE_OPTIONS.map((option) => {
            const selected = option.value === mode;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                disabled={pending}
                onClick={() => save(theme, option.value)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-muted",
                  "disabled:cursor-wait",
                )}
              >
                <Icon className="size-3.5" />
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          System follows your operating system&apos;s light or dark appearance.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
