import { redirect } from "next/navigation";

/**
 * The Settings area now has dedicated children. Keep the old `/settings` URL
 * working by sending it to the page that used to live there.
 */
export default function SettingsIndexPage() {
  redirect("/settings/ai");
}
