/**
 * Intake form model + step definitions.
 *
 * UI-only for now: the values map to the `leads` columns, but nothing is
 * persisted yet (see the submit handler in `intake-form.tsx`).
 */
import type { LucideIcon } from "lucide-react";
import { CarFront, Pill, UserRound, UsersRound } from "lucide-react";

export type Campaign = "MVA" | "MASS_TORT";
export type FillingFor = "Myself" | "SomeoneElse";
export type YesNo = "Yes" | "No";

/** All answers collected across the flow. Empty string = unanswered. */
export interface IntakeValues {
  campaign: Campaign | "";
  incidentDate: string;
  state: string;
  county: string;
  postcode: string;
  howHurt: string;
  description: string;
  atFault: YesNo | "";
  hasAttorney: YesNo | "";
  receivedSettlement: YesNo | "";
  fillingFor: FillingFor | "";
  injuredFirstName: string;
  injuredLastName: string;
  injuredPhone: string;
  injuredEmail: string;
  relationship: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

export const INITIAL_VALUES: IntakeValues = {
  campaign: "",
  incidentDate: "",
  state: "",
  county: "",
  postcode: "",
  howHurt: "",
  description: "",
  atFault: "",
  hasAttorney: "",
  receivedSettlement: "",
  fillingFor: "",
  injuredFirstName: "",
  injuredLastName: "",
  injuredPhone: "",
  injuredEmail: "",
  relationship: "",
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
};

/** Curried-ish updater handed to every step. */
export type UpdateFn = <K extends keyof IntakeValues>(
  key: K,
  value: IntakeValues[K],
) => void;

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: LucideIcon;
}

export const CAMPAIGN_OPTIONS: readonly ChoiceOption<Campaign>[] = [
  {
    value: "MVA",
    label: "A car accident",
    description: "Auto, truck, motorcycle, bike or pedestrian",
    icon: CarFront,
  },
  {
    value: "MASS_TORT",
    label: "A product or drug injury",
    description: "Harm from a medication, device or product",
    icon: Pill,
  },
];

export const FILLING_FOR_OPTIONS: readonly ChoiceOption<FillingFor>[] = [
  {
    value: "Myself",
    label: "Myself",
    description: "I'm the person who was injured",
    icon: UserRound,
  },
  {
    value: "SomeoneElse",
    label: "Someone else",
    description: "I'm helping a family member or friend",
    icon: UsersRound,
  },
];

export interface StepMeta {
  title: string;
  subtitle: string;
}

/** Ordered steps. The last one is the review. */
export const STEPS: readonly StepMeta[] = [
  {
    title: "What can we help with?",
    subtitle: "Pick the option that fits best. This takes about two minutes.",
  },
  {
    title: "When and where?",
    subtitle: "An approximate date is perfectly fine.",
  },
  {
    title: "Tell us what happened",
    subtitle: "A sentence or two is plenty — you can add detail later.",
  },
  {
    title: "A few quick questions",
    subtitle: "These help us match you with the right firm.",
  },
  {
    title: "Who are we helping?",
    subtitle: "Let us know if you're filling this out for someone else.",
  },
  {
    title: "How can we reach you?",
    subtitle: "So our intake team can follow up about your free review.",
  },
  {
    title: "Almost done",
    subtitle: "Please review your answers before you send them.",
  },
];

export const STEP_COUNT = STEPS.length;

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function isValidPhone(value: string): boolean {
  return value.replace(/\D/g, "").length === 10;
}

/** Progressive US phone formatting, e.g. "(303) 555-0168". */
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** Human-friendly date for the review step. */
export function formatDisplayDate(value: string): string {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Named step indexes (keeps the review's "Edit" links in sync with STEPS). */
export const STEP_INDEX = {
  campaign: 0,
  whenWhere: 1,
  incident: 2,
  questions: 3,
  forWhom: 4,
  contact: 5,
  review: 6,
} as const;

/** Whether the given step has enough to move on. */
export function isStepComplete(step: number, v: IntakeValues): boolean {
  switch (step) {
    case STEP_INDEX.campaign:
      return v.campaign !== "";
    case STEP_INDEX.whenWhere:
      return v.incidentDate !== "" && v.state !== "";
    case STEP_INDEX.incident:
      return v.description.trim().length >= 5;
    case STEP_INDEX.questions:
      return (
        (v.campaign === "MASS_TORT" || v.atFault !== "") &&
        v.hasAttorney !== "" &&
        v.receivedSettlement !== ""
      );
    case STEP_INDEX.forWhom:
      return (
        v.fillingFor === "Myself" ||
        (v.fillingFor === "SomeoneElse" &&
          v.injuredFirstName.trim() !== "" &&
          v.injuredLastName.trim() !== "" &&
          v.relationship !== "")
      );
    case STEP_INDEX.contact:
      return (
        v.firstName.trim() !== "" &&
        v.lastName.trim() !== "" &&
        isValidPhone(v.phone) &&
        isValidEmail(v.email)
      );
    default:
      return true;
  }
}
