/**
 * Intake form model + step definitions.
 *
 * Field names mirror the `leads` columns so `buildIntakeSubmission` is a direct
 * mapping and there is no translation layer to drift. Unanswered string fields
 * are `""`, unanswered booleans are `null` (the backend stores both as NULL).
 *
 * Steps are derived from the answers rather than a fixed list: filing for
 * yourself skips the submitter step that a submitter needs when filling in for
 * someone else. We never show a step counter, so the varying length is invisible.
 */
import type { LucideIcon } from "lucide-react";
import { CarFront, Pill, Shapes, UserRound, UsersRound } from "lucide-react";
import type { CaseType, Relationship } from "@/lib/db/schema";
import type { IntakeSubmission } from "@/lib/leads/intake";
import { EMPTY_UTM, type UtmParams } from "@/lib/leads/utm";
import {
  isValidEmail,
  isValidPhone,
  normalizePostcode,
} from "@/lib/validation";

export interface IntakeValues {
  /** Mirrors `leads.is_filling_for_someone_else`; `null` = unanswered. */
  isFillingForSomeoneElse: boolean | null;
  caseType: CaseType | "";
  dateOfAccident: string;
  state: string;
  county: string;
  postcode: string;
  /** Required "what happened" write-up (`leads.accident_details`). */
  accidentDetails: string;
  /** Optional injury details (`leads.injury_details`). */
  injuryDetails: string;
  isAtFault: boolean | null;
  hasAttorney: boolean | null;
  hasReceivedSettlement: boolean | null;
  /**
   * The injured person. Always populated — when filing for yourself this is also
   * the submitter (the `filler*` fields stay empty in the database).
   */
  injuredFirstName: string;
  injuredLastName: string;
  injuredPhone: string;
  injuredEmail: string;
  /** The filler's relationship to the injured person (on-behalf leads only). */
  relationshipToInjured: Relationship | "";
  /** The submitter — required when filing for someone else, empty otherwise. */
  fillerFirstName: string;
  fillerLastName: string;
  fillerPhone: string;
  fillerEmail: string;
}

export const INITIAL_VALUES: IntakeValues = {
  isFillingForSomeoneElse: null,
  caseType: "",
  dateOfAccident: "",
  state: "",
  county: "",
  postcode: "",
  accidentDetails: "",
  injuryDetails: "",
  isAtFault: null,
  hasAttorney: null,
  hasReceivedSettlement: null,
  injuredFirstName: "",
  injuredLastName: "",
  injuredPhone: "",
  injuredEmail: "",
  relationshipToInjured: "",
  fillerFirstName: "",
  fillerLastName: "",
  fillerPhone: "",
  fillerEmail: "",
};

/** Curried-ish updater handed to every step. */
export type UpdateFn = <K extends keyof IntakeValues>(
  key: K,
  value: IntakeValues[K],
) => void;

export interface ChoiceOption<T> {
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

/** `value` matches `leads.is_filling_for_someone_else`. */
export const FILLING_FOR_OPTIONS: readonly ChoiceOption<boolean>[] = [
  {
    value: false,
    label: "Myself",
    description: "I'm the person who was affected",
    icon: UserRound,
  },
  {
    value: true,
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
  if (values.isFillingForSomeoneElse === true) keys.push("filler");
  return keys;
}

export interface StepMeta {
  title: string;
  subtitle?: string;
}

/** Title (and optional subtitle) for a step, given the current answers. */
export function stepMeta(key: StepKey, values: IntakeValues): StepMeta {
  const forSelf = values.isFillingForSomeoneElse !== true;
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

/** Maps a server validation key onto the step that collects that field. */
const STEP_FOR_FIELD: Record<string, StepKey> = {
  isFillingForSomeoneElse: "fillingFor",
  caseType: "caseType",
  dateOfAccident: "whenWhere",
  state: "whenWhere",
  county: "whenWhere",
  postcode: "whenWhere",
  accidentDetails: "incident",
  injuryDetails: "incident",
  isAtFault: "questions",
  hasAttorney: "questions",
  hasReceivedSettlement: "questions",
  injuredFirstName: "injured",
  injuredLastName: "injured",
  injuredPhone: "injured",
  injuredEmail: "injured",
  relationshipToInjured: "injured",
  fillerFirstName: "filler",
  fillerLastName: "filler",
  fillerPhone: "filler",
  fillerEmail: "filler",
};

/** The step that owns the first field error the server reported. */
export function firstErrorStep(
  errors: Record<string, string>,
  stepKeys: StepKey[],
): StepKey | null {
  for (const key of Object.keys(errors)) {
    const step = STEP_FOR_FIELD[key];
    if (step && stepKeys.includes(step)) return step;
  }
  return null;
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
      return v.isFillingForSomeoneElse !== null;
    case "caseType":
      return v.caseType !== "";
    case "whenWhere":
      return (
        v.dateOfAccident !== "" &&
        v.state !== "" &&
        (v.postcode.trim() === "" || normalizePostcode(v.postcode) !== null)
      );
    case "incident":
      return v.accidentDetails.trim().length >= 5;
    case "questions":
      return (
        v.isAtFault !== null &&
        v.hasAttorney !== null &&
        v.hasReceivedSettlement !== null
      );
    case "injured":
      // The injured person's four fields are always required; the relationship
      // is additionally required when filing for someone else.
      return (
        v.injuredFirstName.trim() !== "" &&
        v.injuredLastName.trim() !== "" &&
        isValidPhone(v.injuredPhone) &&
        isValidEmail(v.injuredEmail) &&
        (v.isFillingForSomeoneElse !== true || v.relationshipToInjured !== "")
      );
    case "filler":
      // Required when filing for someone else (this step only exists then).
      return (
        v.fillerFirstName.trim() !== "" &&
        v.fillerLastName.trim() !== "" &&
        isValidPhone(v.fillerPhone) &&
        isValidEmail(v.fillerEmail)
      );
  }
}

const clean = (value: string) => value.trim();
const orNull = (value: string) => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

/**
 * What the form posts. Source/medium/content are derived on the server from
 * `tracking` (a public URL is not the place to let the client pick attribution).
 */
export type IntakePayload = Omit<
  IntakeSubmission,
  "source" | "medium" | "content"
> & { tracking: UtmParams };

/** Map the form's state onto the submission payload (field names already match). */
export function buildIntakeSubmission(
  values: IntakeValues,
  tracking: UtmParams = EMPTY_UTM,
): IntakePayload {
  const forSomeoneElse = values.isFillingForSomeoneElse === true;
  return {
    isFillingForSomeoneElse: forSomeoneElse,
    caseType: values.caseType as CaseType,
    dateOfAccident: orNull(values.dateOfAccident),
    state: values.state,
    county: orNull(values.county),
    postcode: orNull(values.postcode),
    accidentDetails: clean(values.accidentDetails),
    injuryDetails: orNull(values.injuryDetails),
    isAtFault: values.isAtFault === true,
    hasAttorney: values.hasAttorney === true,
    hasReceivedSettlement: values.hasReceivedSettlement === true,
    injuredFirstName: clean(values.injuredFirstName),
    injuredLastName: clean(values.injuredLastName),
    injuredPhone: clean(values.injuredPhone),
    injuredEmail: clean(values.injuredEmail),
    relationshipToInjured:
      forSomeoneElse && values.relationshipToInjured
        ? (values.relationshipToInjured as Relationship)
        : null,
    fillerFirstName: forSomeoneElse ? orNull(values.fillerFirstName) : null,
    fillerLastName: forSomeoneElse ? orNull(values.fillerLastName) : null,
    fillerPhone: forSomeoneElse ? orNull(values.fillerPhone) : null,
    fillerEmail: forSomeoneElse ? orNull(values.fillerEmail) : null,
    tracking,
  };
}
