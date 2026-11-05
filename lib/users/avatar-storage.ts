/**
 * Private storage for profile photos.
 *
 * Files live beside the SQLite database (`data/avatars/` by default) rather than
 * in `public/`, so no URL can reach them without a session. The `users` row
 * stores only the generated filename; `app/api/users/[id]/avatar/route.ts`
 * resolves that filename and streams the bytes to a signed-in viewer.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDatabasePath } from "@/lib/db";

/** Absolute directory that holds every stored avatar. */
export function getAvatarDirectory(): string {
  return path.join(path.dirname(getDatabasePath()), "avatars");
}

/**
 * A stored name must be a single filename, never a path. The database is the
 * only writer, but this keeps a corrupted value from escaping the folder.
 */
function safeFilename(name: string): string | null {
  if (!name || name.includes("..") || name !== path.basename(name)) {
    return null;
  }
  return name;
}

/** Persist `data` and return the generated filename to store on the user row. */
export async function storeAvatarFile(
  userId: number,
  data: Buffer,
): Promise<string> {
  const directory = getAvatarDirectory();
  await mkdir(directory, { recursive: true });

  // A fresh name per upload is what makes the browser cache safe: replacing a
  // photo changes the URL's `v`, so the old image is never served again.
  const filename = `${userId}-${randomUUID()}.webp`;
  await writeFile(path.join(directory, filename), data);
  return filename;
}

/** Read a stored avatar, or `null` when the file is missing or malformed. */
export async function readAvatarFile(name: string): Promise<Buffer | null> {
  const filename = safeFilename(name);
  if (!filename) return null;

  try {
    return await readFile(path.join(getAvatarDirectory(), filename));
  } catch {
    // Missing file is not an error worth surfacing: the UI falls back to the
    // user's initials, which is exactly what a user without a photo sees.
    return null;
  }
}

/** Best-effort removal of a replaced or cleared photo. */
export async function deleteAvatarFile(name: string | null): Promise<void> {
  if (!name) return;
  const filename = safeFilename(name);
  if (!filename) return;

  try {
    await unlink(path.join(getAvatarDirectory(), filename));
  } catch {
    // Already gone is fine; the database no longer references it.
  }
}
