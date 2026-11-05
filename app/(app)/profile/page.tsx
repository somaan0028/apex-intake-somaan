import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { UserAvatarUploader } from "@/components/user-avatar-uploader";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { formatDate } from "@/lib/format";
import { USER_ROLE_LABELS } from "@/lib/labels";
import { countAdmins } from "@/lib/users/queries";
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

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">
          Your account in the intake desk.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
          <UserAvatarUploader
            userId={row.id}
            name={row.name}
            avatarPath={row.avatarPath}
            avatarClassName="size-24"
            fallbackClassName="text-2xl"
            variant="avatar"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold tracking-tight">
                {row.name}
              </h2>
              <Badge variant="secondary">{USER_ROLE_LABELS[row.role]}</Badge>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Member since {formatDate(row.createdAt)}
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
