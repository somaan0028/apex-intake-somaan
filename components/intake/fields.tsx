"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import type { ChoiceOption, YesNo } from "./types";

/** A labelled field with an optional hint and an "Optional" tag. */
export function Field({
  label,
  htmlFor,
  hint,
  optional,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {optional ? (
          <span className="text-xs font-normal text-muted-foreground">
            Optional
          </span>
        ) : null}
      </div>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Large, tappable radio cards. Uses a real (visually hidden) radio input so
 * keyboard and screen-reader semantics come for free.
 */
export function OptionCards<T extends string>({
  name,
  value,
  onChange,
  options,
  columns = 1,
}: {
  name: string;
  value: T | "";
  onChange: (value: T) => void;
  options: readonly ChoiceOption<T>[];
  columns?: 1 | 2;
}) {
  return (
    <div
      role="radiogroup"
      className={cn("grid gap-2.5", columns === 2 && "sm:grid-cols-2")}
    >
      {options.map((option) => {
        const active = value === option.value;
        const Icon = option.icon;
        return (
          <label
            key={option.value}
            className={cn(
              "group/option relative flex cursor-pointer items-start gap-3 rounded-xl border border-input bg-card p-4 text-left transition-all",
              "hover:border-ring/60 hover:bg-accent/40",
              "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40",
              active &&
                "border-primary bg-primary/5 ring-1 ring-primary hover:border-primary hover:bg-primary/5",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={active}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {Icon ? (
              <span
                className={cn(
                  "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors",
                  active && "bg-primary/15 text-primary",
                )}
              >
                <Icon className="size-4.5" />
              </span>
            ) : null}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">{option.label}</span>
              {option.description ? (
                <span className="text-xs text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input",
              )}
            >
              {active ? <Check className="size-3" /> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** Yes/No rendered as two side-by-side option cards. */
export function YesNoField({
  name,
  value,
  onChange,
}: {
  name: string;
  value: YesNo | "";
  onChange: (value: YesNo) => void;
}) {
  return (
    <OptionCards<YesNo>
      name={name}
      value={value}
      onChange={onChange}
      columns={2}
      options={[
        { value: "Yes", label: "Yes" },
        { value: "No", label: "No" },
      ]}
    />
  );
}

/** Progress bar + step counter + the step's title and subtitle. */
export function StepHeader({
  index,
  total,
  title,
  subtitle,
}: {
  index: number;
  total: number;
  title: string;
  subtitle: string;
}) {
  const percent = Math.round(((index + 1) / total) * 100);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>
            Step {index + 1} of {total}
          </span>
          <span className="tabular-nums">{percent}%</span>
        </div>
        <Progress value={percent} />
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight text-balance">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground text-pretty">{subtitle}</p>
      </div>
    </div>
  );
}

/** A titled block on the review step, with an "Edit" affordance. */
export function ReviewSection({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-input bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
      </div>
      <dl className="flex flex-col gap-1.5 text-sm">{children}</dl>
    </div>
  );
}

export function ReviewRow({
  label,
  value,
}: {
  label: string;
  value?: string;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words">
        {value && value.length > 0 ? value : "—"}
      </dd>
    </div>
  );
}
