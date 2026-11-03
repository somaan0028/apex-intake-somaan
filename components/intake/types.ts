/**
 * Intake form model + step definitions.
 *
 * UI-only for now: the values map to the `leads` columns, but nothing is
 * persisted yet (see the submit handler in `intake-form.tsx`).
 *
 * Steps are derived from the answers rather than a fixed list: filing for
 * yourself skips the "your details" step that a submitter needs when filling in
 * for someone else. We never show a step counter, so the varying length is
 * invisible to the person at the keyboard.
 */
import type { LucideIcon } from "lucide-react";
import { CarFront, Pill, Shapes, UserRound, UsersRound } from "lucide-react";

export type CaseType = "MVA" | "MASS_TORT" | "OTHER";
export type FillingFor = "Myself" | "SomeoneElse";
export type YesNo = "Yes" | "No";

/** All answers collected across the flow. Empty string = unanswered. */
export interface IntakeValues {
  fillingFor: FillingFor | "";
  caseType: CaseType | "";
  incidentDate: string;
  state: string;
  county: string;
  postcode: string;
  /** Required "what happened" write-up. */
  description: string;
  /** Optional injury details. */
  howHurt: string;
  atFault: YesNo | "";
  hasAttorney: YesNo | "";
  receivedSettlement: YesNo | "";
  /**
   * The injured person. Always populated — when filing for yourself this is also
   * the submitter (we never duplicate them into the `filler*` fields).
   */
  injuredFirstName: string;
  injuredLastName: string;
  injuredPhone: string;
  injuredEmail: string;
  relationship: string;
  /** The submitter, only collected when filing for someone else. */
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

export const INITIAL_VALUES: IntakeValues = {
  fillingFor: "",
  caseType: "",
  incidentDate: "",
  state: "",
  county: "",
  postcode: "",
  description: "",
  howHurt: "",
  atFault: "",
  hasAttorney: "",
  receivedSettlement: "",
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

export const CASE_TYPE_OPTIONS: readonly ChoiceOption<CaseType>[] = [
  {
    value: "MVA",
    label: "A vehicle accident",
    description: "Car, truck, motorcycle, bike or pedestrian",
    icon: CarFront,
  },
  {
    value: "MASS_TORT",
    label: "Mass Tort",
    description:
      "Harm from a drug, device, product, or other large-scale cause affecting many people",
    icon: Pill,
  },
  {
    value: "OTHER",
    label: "Other",
    description: "Something that doesn't fit the options above",
    icon: Shapes,
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
    description: "I'm helping someone I know (friend, family, etc.)",
    icon: UsersRound,
  },
];

/* ----------------------------------------------------------------- steps */

export type StepKey =
  | "fillingFor"
  | "caseType"
  | "whenWhere"
  | "incident"
  | "questions"
  | "injured"
  | "filler";

/**
 * The ordered steps for the current answers. The submitter step (`filler`) only
 * exists when filing for someone else; the injured person's step is otherwise
 * last.
 */
export function getStepKeys(values: IntakeValues): StepKey[] {
  const keys: StepKey[] = [
    "fillingFor",
    "caseType",
    "whenWhere",
    "incident",
    "questions",
    "injured",
  ];
  if (values.fillingFor === "SomeoneElse") keys.push("filler");
  return keys;
}

export interface StepMeta {
  title: string;
  subtitle?: string;
}

/** Title (and optional subtitle) for a step, given the current answers. */
export function stepMeta(key: StepKey, values: IntakeValues): StepMeta {
  const forSelf = values.fillingFor !== "SomeoneElse";
  switch (key) {
    case "fillingFor":
      return { title: "Who are you filling this form for?" };
    case "caseType":
      return { title: "What kind of case is it?" };
    case "whenWhere":
      return { title: "When and where did it happen?" };
    case "incident":
      return { title: "Tell us what happened" };
    case "questions":
      return {
        title: "A few quick questions",
        subtitle: "These help us match you with the right firm.",
      };
    case "injured":
      return forSelf
        ? { title: "Your details" }
        : { title: "Please enter the injured person's details" };
    case "filler":
      return {
        title: "Your details",
        subtitle: "So our intake team knows who filled the form",
      };
  }
}

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

/** Whether the given step has enough to move on. */
export function isStepComplete(key: StepKey, v: IntakeValues): boolean {
  switch (key) {
    case "fillingFor":
      return v.fillingFor !== "";
    case "caseType":
      return v.caseType !== "";
    case "whenWhere":
      return v.incidentDate !== "" && v.state !== "";
    case "incident":
      return v.description.trim().length >= 5;
    case "questions":
      return (
        v.atFault !== "" &&
        v.hasAttorney !== "" &&
        v.receivedSettlement !== ""
      );
    case "injured":
      if (v.fillingFor === "SomeoneElse") {
        return (
          v.injuredFirstName.trim() !== "" &&
          v.injuredLastName.trim() !== "" &&
          v.relationship !== ""
        );
      }
      return (
        v.injuredFirstName.trim() !== "" &&
        v.injuredLastName.trim() !== "" &&
        isValidPhone(v.injuredPhone) &&
        isValidEmail(v.injuredEmail)
      );
    case "filler":
      return (
        v.firstName.trim() !== "" &&
        v.lastName.trim() !== "" &&
        isValidPhone(v.phone) &&
        isValidEmail(v.email)
      );
  }
}
