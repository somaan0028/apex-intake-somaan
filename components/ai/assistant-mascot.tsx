"use client";

/**
 * The assistant's mascot — a small friendly robot, drawn inline so it inherits
 * the theme (light/dark) and needs no image request.
 *
 * Pure decoration, so it is hidden from assistive tech; the surrounding copy
 * carries the meaning.
 */
export function AssistantMascot({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden
      focusable="false"
      fill="none"
      className={className}
    >
      {/* Antenna, topped with a sparkle: this is the "assistant" cue. */}
      <path
        d="M32 15v-4"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="text-primary"
      />
      <path
        d="M32 3.5 33.1 7l3.4 1-3.4 1L32 12.5 30.9 9 27.5 8l3.4-1L32 3.5Z"
        className="fill-primary"
      />

      {/* Head */}
      <rect
        x="9"
        y="15"
        width="46"
        height="36"
        rx="13"
        className="fill-primary/15 stroke-primary"
        strokeWidth="2.5"
      />

      {/* Visor the eyes sit on, so they read clearly in both themes. */}
      <rect
        x="17"
        y="24"
        width="30"
        height="16"
        rx="8"
        className="fill-background"
      />

      {/* Eyes */}
      <circle cx="25.5" cy="32" r="3.2" className="fill-primary" />
      <circle cx="38.5" cy="32" r="3.2" className="fill-primary" />

      {/* Smile */}
      <path
        d="M27 45c2.6 2.4 7.4 2.4 10 0"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="text-primary"
      />

      {/* Ears */}
      <rect x="3.5" y="27" width="5" height="13" rx="2.5" className="fill-primary/40" />
      <rect x="55.5" y="27" width="5" height="13" rx="2.5" className="fill-primary/40" />
    </svg>
  );
}
