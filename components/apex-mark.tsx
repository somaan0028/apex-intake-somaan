import { cn } from "@/lib/utils";

/** Pointed, teardrop-shaped counter that gives the mark its negative space. */
const COUNTER =
  "M50 20C57 30 57 45 46 59C43 63 39 65 35 65C37 50 43 33 50 20Z";

/**
 * Apex brand mark: a fluid "A" ribbon with a leaf-shaped counter and a
 * sweeping slit that frees the bottom ribbon.
 *
 * The glyph is monochrome and inherits `currentColor`, so the logo stays
 * black-and-white regardless of the active theme. The favicon
 * (`app/icon.svg`) is the fixed version (white mark on a black tile) of the
 * same geometry.
 */
export function ApexMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      className={cn("size-4", className)}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d={
          "M50 8C60 8 64 18 68 30C74 45 82 62 88 76C90 82 87 86 82 86" +
          "C74 86 66 86 58 86C50 86 42 87 34 86C28 85 24 83 22 80" +
          "C34 79 46 77 56 73C60 71.5 60 68.5 55 70C42 73 30 76 20 76" +
          "C13 76 11 72 14 67C18 56 24 42 30 28C34 16 40 8 50 8Z" +
          COUNTER
        }
      />
    </svg>
  );
}
