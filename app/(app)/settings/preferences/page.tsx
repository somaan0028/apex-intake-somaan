import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getUserPreferences } from "@/lib/preferences/queries";
import { AppearanceSettings } from "./appearance-settings";

export const metadata: Metadata = {
  title: "Preferences · Apex Intake Desk",
};

/**
 * Personal preferences. Appearance is the first section; the same JSON column
 * is ready for future choices such as which Overview stats to show.
 */
export default async function PreferencesPage() {
  const user = await requireUser();
  const preferences = getUserPreferences(user.id);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Preferences</h1>
        <p className="text-muted-foreground">
          Customize how the intake desk works for you.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <p className="text-sm text-muted-foreground">
            Set your dashboard the way you like
          </p>
        </CardHeader>
        <CardContent>
          <AppearanceSettings initial={preferences.appearance} />
        </CardContent>
      </Card>
    </div>
  );
}
