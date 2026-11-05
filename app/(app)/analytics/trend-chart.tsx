"use client";

/**
 * The Analytics trend chart.
 *
 * A multi-series line chart with a dot on every bucket, gridlines and a
 * hoverable crosshair. The previous bar chart showed volume only; plotting
 * Qualified/Retained/Sent against the intake line makes the funnel visible
 * without a second chart.
 *
 * It is deliberately dependency-free SVG so it inherits the active theme's
 * `--chart-*` and `--border` tokens (see `app/globals.css`).
 */
import { useMemo, useState } from "react";
import type { TrendPoint } from "@/lib/leads/analytics";

const SERIES = [
  { key: "total", label: "Leads", color: "var(--chart-1)" },
  { key: "qualified", label: "Qualified+", color: "var(--chart-2)" },
  { key: "retained", label: "Retained+", color: "var(--chart-3)" },
  { key: "sent", label: "Sent to firm", color: "var(--chart-4)" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

const WIDTH = 860;
const HEIGHT = 300;
const PADDING = { top: 18, right: 18, bottom: 34, left: 46 };
const PLOT_WIDTH = WIDTH - PADDING.left - PADDING.right;
const PLOT_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom;

/** Round the axis up to a 1/2/5-style step so tick labels stay whole numbers. */
function axisScale(value: number): { max: number; step: number } {
  if (value <= 0) return { max: 1, step: 1 };
  const rough = value / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) *
    magnitude;
  return { max: Math.ceil(value / step) * step, step };
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const peak = useMemo(
    () => points.reduce((max, point) => Math.max(max, point.total), 0),
    [points],
  );
  const { max, step } = axisScale(peak);

  if (points.length === 0 || peak === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No leads in this window yet.
      </p>
    );
  }

  const xFor = (index: number) =>
    points.length === 1
      ? PADDING.left + PLOT_WIDTH / 2
      : PADDING.left + (index / (points.length - 1)) * PLOT_WIDTH;
  const yFor = (value: number) =>
    PADDING.top + PLOT_HEIGHT - (value / max) * PLOT_HEIGHT;

  const ticks: number[] = [];
  for (let value = 0; value <= max; value += step) ticks.push(value);

  // Keep the axis legible at every granularity: at most ~8 date labels.
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  const hoveredPoint = hovered === null ? null : points[hovered];
  const hoveredX = hovered === null ? 0 : xFor(hovered);
  const tooltipLeft = Math.min(
    86,
    Math.max(14, (hoveredX / WIDTH) * 100),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {SERIES.map((series) => (
          <span
            key={series.key}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ backgroundColor: series.color }}
            />
            {series.label}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <div className="relative min-w-[42rem]">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label="Lead volume and funnel outcomes over time"
            className="h-auto w-full"
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PADDING.left}
                  x2={WIDTH - PADDING.right}
                  y1={yFor(tick)}
                  y2={yFor(tick)}
                  stroke="var(--border)"
                  strokeDasharray="3 4"
                  strokeOpacity={0.7}
                />
                <text
                  x={PADDING.left - 8}
                  y={yFor(tick) + 3}
                  textAnchor="end"
                  fontSize={10}
                  fill="var(--muted-foreground)"
                >
                  {tick}
                </text>
              </g>
            ))}

            {points.map((point, index) => {
              const showLabel =
                index % labelEvery === 0 || index === points.length - 1;
              if (!showLabel) return null;
              return (
                <text
                  key={point.key}
                  x={xFor(index)}
                  y={HEIGHT - 12}
                  textAnchor={
                    index === 0
                      ? "start"
                      : index === points.length - 1
                        ? "end"
                        : "middle"
                  }
                  fontSize={10}
                  fill="var(--muted-foreground)"
                >
                  {point.label}
                </text>
              );
            })}

            {hovered !== null ? (
              <line
                x1={hoveredX}
                x2={hoveredX}
                y1={PADDING.top}
                y2={PADDING.top + PLOT_HEIGHT}
                stroke="var(--border)"
                strokeWidth={1}
              />
            ) : null}

            {SERIES.map((series) => {
              const path = points
                .map(
                  (point, index) =>
                    `${index === 0 ? "M" : "L"}${xFor(index).toFixed(2)} ${yFor(
                      point[series.key as SeriesKey],
                    ).toFixed(2)}`,
                )
                .join(" ");

              return (
                <g key={series.key}>
                  <path
                    d={path}
                    fill="none"
                    stroke={series.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {points.map((point, index) => (
                    <circle
                      key={point.key}
                      cx={xFor(index)}
                      cy={yFor(point[series.key as SeriesKey])}
                      r={hovered === index ? 4 : 2.5}
                      fill={series.color}
                      stroke="var(--background)"
                      strokeWidth={1.5}
                    />
                  ))}
                </g>
              );
            })}

            {/* Wide invisible hit areas make the dots easy to hover. */}
            {points.map((point, index) => {
              const left =
                index === 0
                  ? PADDING.left
                  : (xFor(index - 1) + xFor(index)) / 2;
              const right =
                index === points.length - 1
                  ? WIDTH - PADDING.right
                  : (xFor(index) + xFor(index + 1)) / 2;
              return (
                <rect
                  key={point.key}
                  x={left}
                  y={PADDING.top}
                  width={Math.max(0, right - left)}
                  height={PLOT_HEIGHT}
                  fill="transparent"
                  pointerEvents="all"
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                />
              );
            })}
          </svg>

          {hoveredPoint ? (
            <div
              className="pointer-events-none absolute top-1 z-10 w-44 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-2 text-xs shadow-md"
              style={{ left: `${tooltipLeft}%` }}
            >
              <p className="mb-1 font-medium">{hoveredPoint.fullLabel}</p>
              <dl className="space-y-0.5">
                {SERIES.map((series) => (
                  <div
                    key={series.key}
                    className="flex items-center justify-between gap-2"
                  >
                    <dt className="flex items-center gap-1.5 text-muted-foreground">
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full"
                        style={{ backgroundColor: series.color }}
                      />
                      {series.label}
                    </dt>
                    <dd className="font-medium tabular-nums">
                      {hoveredPoint[series.key as SeriesKey]}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
