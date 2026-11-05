/**
 * Authenticated profile-photo delivery.
 *
 * Avatars live in a private folder beside the database, not in `public/`, so
 * this route is the only way to read one. `proxy.ts` already requires a session
 * cookie, but that is not a security boundary: this handler validates the
 * session against the database and only then streams the file.
 */
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { readAvatarFile } from "@/lib/users/avatar-storage";

// The response depends on the session cookie and the current row, never on a
// shared cache. `getCurrentUser()` reads cookies, so the route is dynamic; with
// `cacheComponents` the route-segment `dynamic` export is not allowed.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await getCurrentUser();
  if (!viewer) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return new Response("Not found", { status: 404 });
  }

  const row = getDb()
    .select({ avatarPath: users.avatarPath })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (!row?.avatarPath) {
    return new Response("Not found", { status: 404 });
  }

  const image = await readAvatarFile(row.avatarPath);
  if (!image) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/webp",
      // The URL carries the stored filename as `v`, so a replaced photo gets a
      // new URL and can safely be cached for a long time by this browser only.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
