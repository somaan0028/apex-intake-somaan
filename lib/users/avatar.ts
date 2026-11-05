/**
 * Profile-photo rules shared by the browser and the server.
 *
 * The browser uses these to reject an obviously wrong file before uploading;
 * the Server Action re-checks all of them, because a client-side check is only
 * a convenience (see `lib/users/avatar-actions.ts`).
 */

/** Largest original file we accept from the browser (5 MB). */
export const AVATAR_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** The processed image is always a square of this many pixels. */
export const AVATAR_SIZE = 256;

/**
 * The processed WebP should never approach this, but the limit is a final guard
 * against a pathological encoder result reaching the private folder.
 */
export const AVATAR_MAX_STORED_BYTES = 256 * 1024;

/** Formats we decode. SVG is deliberately absent: it can carry script. */
export const AVATAR_ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/** The file picker's `accept` attribute. */
export const AVATAR_ACCEPT = AVATAR_ACCEPTED_TYPES.join(",");

/**
 * URL for a user's stored photo.
 *
 * The `v` is the stored filename, which changes on every upload, so a replaced
 * photo is never masked by the browser's cache. The route itself is session
 * protected.
 */
export function avatarUrl(userId: number, avatarPath: string): string {
  return `/api/users/${userId}/avatar?v=${encodeURIComponent(avatarPath)}`;
}

/** Human-readable size for the upload hint. */
export const AVATAR_MAX_UPLOAD_LABEL = "5 MB";

/**
 * Whether the bytes really begin with a PNG, JPEG or WebP signature.
 *
 * The browser's `File.type` is only a claim. Checking the magic bytes before
 * handing the buffer to the decoder keeps an SVG (or any other format that
 * happens to be labelled `image/png`) out of the image pipeline.
 */
export function hasAllowedImageSignature(bytes: Uint8Array): boolean {
  const startsWith = (signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);

  // PNG
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return true;
  }

  // JPEG
  if (startsWith([0xff, 0xd8, 0xff])) return true;

  // WebP: "RIFF" .... "WEBP"
  if (
    startsWith([0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return true;
  }

  return false;
}
