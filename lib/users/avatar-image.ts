/**
 * Server-side avatar processing.
 *
 * `sharp` is only imported here, so the image codec never reaches the browser
 * bundle. Every upload is rotated by its EXIF orientation, cropped to a centred
 * square, downscaled to `AVATAR_SIZE`, and re-encoded as WebP. Re-encoding is
 * also what strips metadata (including location) from the original.
 */
import sharp from "sharp";
import { AVATAR_MAX_STORED_BYTES, AVATAR_SIZE } from "./avatar";

/**
 * Turn arbitrary accepted image bytes into the one size/format we store.
 *
 * `limitInputPixels` refuses decompression bombs before they allocate enormous
 * buffers. Errors bubble up so the action can return a friendly message.
 */
export async function processAvatar(input: Buffer): Promise<Buffer> {
  const output = await sharp(input, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, {
      fit: "cover",
      position: "attention",
    })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();

  if (output.length > AVATAR_MAX_STORED_BYTES) {
    throw new Error("The processed photo is unexpectedly large.");
  }

  return output;
}
