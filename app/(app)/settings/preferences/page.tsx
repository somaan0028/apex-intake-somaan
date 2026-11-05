import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Preferences · Apex Intake Desk",
};

/**
 * Placeholder for the personal preferences surface. The shell is in place so
 * the Settings group can link here; the controls will be added later.
 */
export default function PreferencesPage() {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Preferences</h1>
        <p className="text-muted-foreground">
          Customize how the intake desk works for you.
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        Preferences will appear here soon.
      </p>
    </div>
  );
}
