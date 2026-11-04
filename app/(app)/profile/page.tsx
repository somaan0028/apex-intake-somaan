import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { formatDate, initials } from "@/lib/format";
import { USER_ROLE_LABELS } from "@/lib/labels";
import { countAdmins, countAssignedLeads } from "@/lib/users/queries";
import { ProfileForms } from "./profile-forms";

export const metadata: Metadata = {
  title: "Profile · Apex Intake Desk",
};

/**
 * A user's own profile: what the desk knows about them, and what they may change
 * about it. Reachable by everyone — this is self-service, not user management,
 * so there is no permission gate. What an agent may edit is decided in
 * `lib/auth/profile-actions.ts`.
 */
export default async function ProfilePage() {
  const session = await requireUser();

  // The session proves identity; the row is the current state. Re-read it so a
  // role or email changed elsewhere shows up here immediately.
  const row = getDb()
    .select()
    .from(users)
    .where(eq(users.id, session.id))
    .get();
  if (!row) redirect("/login");

  const assigned = countAssignedLeads(row.id);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">
          Your account in the intake desk.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4">
          <Avatar className="size-14">
            <AvatarFallback className="text-base">
              {initials(row.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-lg font-medium">{row.name}</p>
              <Badge variant="secondary">{USER_ROLE_LABELS[row.role]}</Badge>
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {row.email}
            </p>
            <p className="text-xs text-muted-foreground">
              Joined {formatDate(row.createdAt)} · {assigned} lead
              {assigned === 1 ? "" : "s"} assigned to you
            </p>
          </div>
        </CardContent>
      </Card>

      <ProfileForms
        viewer={{
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
        }}
        adminCount={countAdmins()}
      />
    </div>
  );
}
