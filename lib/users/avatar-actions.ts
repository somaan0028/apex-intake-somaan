"use server";

/**
 * Server Actions for profile photos.
 *
 * The same action serves both surfaces: a person changing their own picture on
 * `/profile`, and an admin changing anyone's from the Users dialog. The target
 * defaults to the caller and is authorised against the freshly loaded session
 * (`requireUserAvatarChange`), so a hidden input alone cannot reach another
 * account.
 *
 * Every upload is decoded, resized, and re-encoded server-side; the browser's
 * type, size, and signature checks are only a fast path.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ForbiddenError, requireUserAvatarChange } from "@/lib/auth/authorize";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  AVATAR_ACCEPTED_TYPES,
  AVATAR_MAX_UPLOAD_BYTES,
  AVATAR_MAX_UPLOAD_LABEL,
  hasAllowedImageSignature,
} from "./avatar";
import { processAvatar } from "./avatar-image";
import { deleteAvatarFile, storeAvatarFile } from "./avatar-storage";

/** Result the uploader renders. */
export interface AvatarActionResult {
  ok: boolean;
  error?: string;
  /** The newly stored filename, or `null` after a removal. */
  avatarPath?: string | null;
}

/** Revalidate every surface that renders an avatar. */
function revalidateAvatars(): void {
  // The sidebar is part of the root layout, so it needs the layout revalidation.
  revalidatePath("/", "layout");
  revalidatePath("/profile");
  revalidatePath("/users");
  revalidatePath("/activity");
}

/** Resolve and authorise the target user for this upload. */
async function resolveTarget(
  formData: FormData,
): Promise<
  | { ok: true; targetId: number; currentPath: string | null }
  | { ok: false; error: string }
> {
  const actor = await requireUser();
  const submitted = String(formData.get("userId") ?? "").trim();
  const targetId = submitted ? Number(submitted) : actor.id;

  if (!Number.isInteger(targetId) || targetId <= 0) {
    return { ok: false, error: "Unknown user." };
  }

  requireUserAvatarChange(actor, targetId);

  const target = getDb()
    .select({ id: users.id, avatarPath: users.avatarPath })
    .from(users)
    .where(eq(users.id, targetId))
    .get();
  if (!target) return { ok: false, error: "That user no longer exists." };

  return { ok: true, targetId, currentPath: target.avatarPath };
}

/** Upload and replace a user's photo. */
export async function uploadAvatar(
  formData: FormData,
): Promise<AvatarActionResult> {
  try {
    const target = await resolveTarget(formData);
    if (!target.ok) return target;

    const file = formData.get("avatar");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Choose an image to upload." };
    }
    if (file.size > AVATAR_MAX_UPLOAD_BYTES) {
      return {
        ok: false,
        error: `Choose an image smaller than ${AVATAR_MAX_UPLOAD_LABEL}.`,
      };
    }
    if (!(AVATAR_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
      return { ok: false, error: "Choose a PNG, JPEG or WebP image." };
    }

    const original = Buffer.from(await file.arrayBuffer());
    if (!hasAllowedImageSignature(original)) {
      return { ok: false, error: "That file is not a supported image." };
    }

    let processed: Buffer;
    try {
      processed = await processAvatar(original);
    } catch {
      return {
        ok: false,
        error: "That image could not be read. Try a different file.",
      };
    }

    const storedName = await storeAvatarFile(target.targetId, processed);

    try {
      getDb()
        .update(users)
        .set({ avatarPath: storedName })
        .where(eq(users.id, target.targetId))
        .run();
    } catch (error) {
      // Do not leave an orphan behind when the row could not be updated.
      await deleteAvatarFile(storedName);
      throw error;
    }

    // The old file is only removed once the new one is live in the database.
    await deleteAvatarFile(target.currentPath);

    revalidateAvatars();
    return { ok: true, avatarPath: storedName };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: error.message };
    }
    console.error("[avatar] upload failed:", error);
    return {
      ok: false,
      error: "Something went wrong while saving the photo. Please try again.",
    };
  }
}

/** Remove a user's photo, returning them to initials. */
export async function removeAvatar(
  formData: FormData,
): Promise<AvatarActionResult> {
  try {
    const target = await resolveTarget(formData);
    if (!target.ok) return target;

    getDb()
      .update(users)
      .set({ avatarPath: null })
      .where(eq(users.id, target.targetId))
      .run();

    await deleteAvatarFile(target.currentPath);
    revalidateAvatars();
    return { ok: true, avatarPath: null };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: error.message };
    }
    console.error("[avatar] remove failed:", error);
    return {
      ok: false,
      error: "Something went wrong while removing the photo. Please try again.",
    };
  }
}
