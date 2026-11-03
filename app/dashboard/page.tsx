import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { logout } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";

// The page reads the session, so it must block on the server rather than
// prerender a static shell (cacheComponents is enabled).
export const instant = false;

export const metadata: Metadata = {
  title: "Dashboard · Apex Intake Desk",
};

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">This is the dashboard route.</h1>
        <p className="text-muted-foreground">
          Dummy dashboard content — the real dashboard comes next.
        </p>
        <p className="text-sm text-muted-foreground">
          Signed in as {user.name} ({user.email}) — role: {user.role}.
        </p>
      </div>
      <form action={logout}>
        <Button type="submit" variant="outline">
          Log out
        </Button>
      </form>
    </main>
  );
}
