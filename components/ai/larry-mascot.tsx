"use client";

/**
 * Larry's mascot.
 *
 * Plays the idle segment of the Lottie animation (`public/lottie/larry.lottie`,
 * extracted to `public/lottie/larry.json`) in the theme's primary colour.
 *
 * The source artwork uses white line work and saturated gradients, so every
 * fill, stroke and gradient stop is remapped onto the live `--primary` value
 * (keeping each colour's brightness) before each render. `lottie-web` renders
 * SVG, which lets us repaint the shape data itself; a canvas player could only
 * be tinted with filters, which no theme would match. The animation is
 * restarted only when the theme actually changes, so switching presets
 * recolours it.
 */
import { useEffect, useRef } from "react";
import animationData from "@/public/lottie/larry.json";

/** The idle segment is frames 0–60 in the source file (60 fps, 1 second). */
const IDLE_SEGMENT: [number, number] = [0, 60];

type Rgb = [number, number, number];

/**
 * Resolve any CSS colour the theme may use (`oklch`, `hsl`, hex, …) to lottie's
 * 0–1 RGB triple. The canvas does the colour-space conversion for us, so theme
 * presets are supported without knowing how they define their palette.
 */
function resolveColor(cssColor: string): Rgb {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [0, 0, 0];

  context.clearRect(0, 0, 1, 1);
  context.fillStyle = cssColor;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return [(red ?? 0) / 255, (green ?? 0) / 255, (blue ?? 0) / 255];
}

/**
 * Recolour one source colour into the theme's primary while keeping its
 * relative brightness, so the artwork's shading survives the tint. The source
 * is a mix of white line work and vivid gradients; flattening both to one flat
 * colour would turn the mascot into a silhouette.
 */
function shadeInto(color: Rgb, base: Rgb): Rgb {
  const luminance =
    0.2126 * (color[0] ?? 0) +
    0.7152 * (color[1] ?? 0) +
    0.0722 * (color[2] ?? 0);
  const factor = 0.45 + 1.05 * luminance;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return [
    clamp((base[0] ?? 0) * factor),
    clamp((base[1] ?? 0) * factor),
    clamp((base[2] ?? 0) * factor),
  ];
}

/**
 * A lottie gradient stores its stops as a flat `[offset, r, g, b, …]` list, so
 * every group of four values is one stop. Rewrite each colour in place.
 */
function tintGradientStops(stops: unknown, base: Rgb) {
  if (!Array.isArray(stops)) return;
  for (let index = 0; index + 3 < stops.length; index += 4) {
    const color: Rgb = [
      Number(stops[index + 1] ?? 0),
      Number(stops[index + 2] ?? 0),
      Number(stops[index + 3] ?? 0),
    ];
    const shaded = shadeInto(color, base);
    stops[index + 1] = shaded[0];
    stops[index + 2] = shaded[1];
    stops[index + 3] = shaded[2];
  }
}

/**
 * Clone the animation with every fill, stroke and gradient recoloured from
 * `primary`. Animated gradients are rewritten keyframe by keyframe.
 */
function tintedAnimation(data: typeof animationData, primary: Rgb) {
  const copy = structuredClone(data) as unknown as Record<string, unknown>;

  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;

    const record = node as Record<string, unknown>;
    const isPaint = record.ty === "fl" || record.ty === "st";
    const paint = record.c as { a?: number; k?: unknown } | undefined;
    if (
      isPaint &&
      paint &&
      paint.a === 0 &&
      Array.isArray(paint.k) &&
      paint.k.length === 3
    ) {
      paint.k = shadeInto(
        [
          Number(paint.k[0] ?? 0),
          Number(paint.k[1] ?? 0),
          Number(paint.k[2] ?? 0),
        ],
        primary,
      );
    }

    const gradient = record.g as
      | { k?: { a?: number; k?: unknown } }
      | undefined;
    if (
      (record.ty === "gf" || record.ty === "gs") &&
      gradient?.k?.k !== undefined
    ) {
      const stops = gradient.k.k;
      if (gradient.k.a === 0) {
        tintGradientStops(stops, primary);
      } else if (Array.isArray(stops)) {
        for (const frame of stops) {
          if (!frame || typeof frame !== "object") continue;
          const keyframe = frame as { s?: unknown; e?: unknown };
          tintGradientStops(keyframe.s, primary);
          tintGradientStops(keyframe.e, primary);
        }
      }
    }

    Object.values(record).forEach(visit);
  };

  visit(copy.layers);
  return copy as unknown as typeof animationData;
}

export function LarryMascot({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let animation: import("lottie-web").AnimationItem | null = null;
    let lottie: typeof import("lottie-web").default | null = null;
    let paintedColor = "";
    let observer: MutationObserver | null = null;

    /** Repaint only when the resolved primary colour has actually changed. */
    const paint = () => {
      if (!lottie || disposed) return;
      const primary = getComputedStyle(document.documentElement)
        .getPropertyValue("--primary")
        .trim();
      if (!primary || primary === paintedColor) return;
      paintedColor = primary;

      animation?.destroy();
      animation = lottie.loadAnimation({
        container,
        renderer: "svg",
        loop: true,
        autoplay: true,
        animationData: tintedAnimation(animationData, resolveColor(primary)),
        initialSegment: IDLE_SEGMENT,
        rendererSettings: {
          preserveAspectRatio: "xMidYMid meet",
          // The artwork sits in the middle of a 512×512 canvas with a lot of
          // empty margin. This box is the union of every frame in the idle
          // segment (plus a little breathing room), so the mascot fills the
          // card instead of floating in a third of it.
          viewBoxSize: "84 108 338 338",
        },
      });
    };

    // Loaded lazily: `lottie-web` touches `window` at import time, so pulling it
    // in at module scope would break server rendering of this client component.
    // The SVG-only build keeps the dashboard chunk small — we never use canvas.
    void import("lottie-web/build/player/lottie_svg").then((module) => {
      if (disposed) return;
      lottie = module.default;
      paint();
      observer = new MutationObserver(paint);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "data-theme", "data-theme-mode"],
      });
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      animation?.destroy();
    };
  }, []);

  return <div ref={containerRef} aria-hidden className={className} />;
}
