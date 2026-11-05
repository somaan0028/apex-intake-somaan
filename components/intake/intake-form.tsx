"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { US_STATES } from "@/lib/us-states";
import { COUNTIES_BY_STATE } from "@/lib/us-counties";
import { RELATIONSHIP_LABELS } from "@/lib/labels";
import { normalizePostcode } from "@/lib/validation";
import {
  caseTypeFromCampaign,
  readUtmParams,
  type UtmParams,
} from "@/lib/leads/utm";
import { formatPhone } from "@/lib/format";
import { Field, OptionCards, StepHeader, YesNoField } from "./fields";
import {
  CASE_TYPE_OPTIONS,
  FILLING_FOR_OPTIONS,
  INITIAL_VALUES,
  buildIntakeSubmission,
  firstErrorStep,
  getStepKeys,
  isStepComplete,
  stepMeta,
  type IntakeValues,
  type UpdateFn,
} from "./types";

/** Matches the endpoint's free-text guard. */
const MAX_TEXT_LENGTH = 5000;

interface StepProps {
  values: IntakeValues;
  update: UpdateFn;
}

/** Select item lists (kept at module scope so they are stable). */
const STATE_ITEMS = US_STATES.map((state) => ({
  label: state.name,
  value: state.code,
}));
const RELATIONSHIP_ITEMS = Object.entries(RELATIONSHIP_LABELS).map(
  ([value, label]) => ({ value, label }),
);

/** Shown under the case-type title when the ad campaign preselected it. */
const AUTO_SELECTED_NOTE =
  "This option has been auto selected based on the ad that you clicked on. Feel free to change it if you'd like";

/* ------------------------------------------------------------------ steps */

function FillingForStep({ values, update }: StepProps) {
  return (
    <OptionCards<boolean>
      name="isFillingForSomeoneElse"
      value={values.isFillingForSomeoneElse}
      onChange={(value) => update("isFillingForSomeoneElse", value)}
      options={FILLING_FOR_OPTIONS}
      columns={2}
    />
  );
}

function CaseTypeStep({ values, update }: StepProps) {
  return (
    <OptionCards
      name="caseType"
      value={values.caseType || null}
      onChange={(value) => update("caseType", value)}
      options={CASE_TYPE_OPTIONS}
    />
  );
}

function WhenWhereStep({ values, update }: StepProps) {
  const isMva = values.caseType === "MVA";

  // Set the date ceiling on the client only (avoids an SSR/client mismatch).
  const [today, setToday] = React.useState("");
  React.useEffect(() => {
    setToday(new Date().toISOString().slice(0, 10));
  }, []);

  // Counties depend on the chosen state.
  const counties = values.state ? (COUNTIES_BY_STATE[values.state] ?? []) : [];

  return (
    <>
      <Field
        label={isMva ? "When did the accident happen?" : "When did this start?"}
        htmlFor="dateOfAccident"
        hint="An approximate date is fine."
      >
        <DatePicker
          id="dateOfAccident"
          value={values.dateOfAccident}
          onChange={(value) => update("dateOfAccident", value)}
          max={today || undefined}
          placeholder="Choose a date"
        />
      </Field>

      <Field label="Which state did it happen in?" htmlFor="state">
        <Select
          items={STATE_ITEMS}
          value={values.state || null}
          onValueChange={(value) => {
            update("state", value ?? "");
            update("county", "");
          }}
        >
          <SelectTrigger id="state" className="h-11 w-full">
            <SelectValue placeholder="Select a state" />
          </SelectTrigger>
          <SelectContent>
            {US_STATES.map((state) => (
              <SelectItem key={state.code} value={state.code}>
                {state.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="County" htmlFor="county" optional>
          <Select
            items={counties.map((name) => ({ label: name, value: name }))}
            value={values.county || null}
            onValueChange={(value) => update("county", value ?? "")}
            disabled={!values.state}
          >
            <SelectTrigger id="county" className="h-11 w-full">
              <SelectValue
                placeholder={
                  values.state ? "Select a county" : "Select a state first"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {counties.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="ZIP code"
          htmlFor="postcode"
          optional
          error={
            values.postcode.trim() !== "" &&
            normalizePostcode(values.postcode) === null
              ? "Enter a valid ZIP code."
              : undefined
          }
        >
          <Input
            id="postcode"
            inputMode="numeric"
            autoComplete="postal-code"
            value={values.postcode}
            onChange={(event) => update("postcode", event.target.value)}
            className="h-11"
          />
        </Field>
      </div>
    </>
  );
}

function IncidentStep({ values, update }: StepProps) {
  const isMva = values.caseType === "MVA";

  return (
    <>
      {/* Required first, optional second. */}
      <Field
        label={
          isMva
            ? "Briefly describe the accident"
            : "Briefly describe what happened"
        }
        htmlFor="accidentDetails"
      >
        <Textarea
          id="accidentDetails"
          rows={4}
          placeholder={
            isMva
              ? "I was rear-ended at a red light…"
              : "I was prescribed… and started noticing…"
          }
          value={values.accidentDetails}
          maxLength={MAX_TEXT_LENGTH}
          onChange={(event) => update("accidentDetails", event.target.value)}
        />
      </Field>

      <Field
        label={isMva ? "What injuries did you suffer?" : "How were you harmed?"}
        htmlFor="injuryDetails"
        optional
      >
        <Textarea
          id="injuryDetails"
          rows={3}
          placeholder={
            isMva
              ? "Neck and back injuries."
              : "Back pain, a skin reaction, or a diagnosed condition."
          }
          value={values.injuryDetails}
          maxLength={MAX_TEXT_LENGTH}
          onChange={(event) => update("injuryDetails", event.target.value)}
        />
      </Field>
    </>
  );
}

function QuestionsStep({ values, update }: StepProps) {
  const isMva = values.caseType === "MVA";
  const forSomeoneElse = values.isFillingForSomeoneElse === true;

  const atFaultLabel = forSomeoneElse
    ? isMva
      ? "Was the injured person at fault for the accident?"
      : "Was the injured person at fault?"
    : isMva
      ? "Were you at fault for the accident?"
      : "Were you at fault?";

  return (
    <>
      <Field label={atFaultLabel}>
        <YesNoField
          name="isAtFault"
          value={values.isAtFault}
          onChange={(value) => update("isAtFault", value)}
        />
      </Field>

      <Field
        label={
          forSomeoneElse
            ? "Does the injured person already have an attorney?"
            : "Do you already have an attorney?"
        }
      >
        <YesNoField
          name="hasAttorney"
          value={values.hasAttorney}
          onChange={(value) => update("hasAttorney", value)}
        />
      </Field>

      <Field
        label={
          forSomeoneElse
            ? "Has the injured person received any settlement or insurance payment?"
            : "Have you received any settlement or insurance payment?"
        }
      >
        <YesNoField
          name="hasReceivedSettlement"
          value={values.hasReceivedSettlement}
          onChange={(value) => update("hasReceivedSettlement", value)}
        />
      </Field>
    </>
  );
}

/** The injured person's details. For the submitter too when filing for self. */
function InjuredStep({ values, update }: StepProps) {
  const forSomeoneElse = values.isFillingForSomeoneElse === true;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={forSomeoneElse ? "Their first name" : "First name"}
          htmlFor="injuredFirstName"
        >
          <Input
            id="injuredFirstName"
            autoComplete={forSomeoneElse ? undefined : "given-name"}
            placeholder="e.g. Jane"
            value={values.injuredFirstName}
            onChange={(event) => update("injuredFirstName", event.target.value)}
            className="h-11"
          />
        </Field>
        <Field
          label={forSomeoneElse ? "Their last name" : "Last name"}
          htmlFor="injuredLastName"
        >
          <Input
            id="injuredLastName"
            autoComplete={forSomeoneElse ? undefined : "family-name"}
            placeholder="e.g. Doe"
            value={values.injuredLastName}
            onChange={(event) => update("injuredLastName", event.target.value)}
            className="h-11"
          />
        </Field>
      </div>

      {forSomeoneElse ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Label htmlFor="relationshipToInjured" className="shrink-0 text-sm">
            The injured person is my
          </Label>
          <div className="min-w-0 flex-1">
            <Select
              items={RELATIONSHIP_ITEMS}
              value={values.relationshipToInjured || null}
              onValueChange={(value) =>
                update("relationshipToInjured", value ?? "")
              }
            >
              <SelectTrigger id="relationshipToInjured" className="h-11 w-full">
                <SelectValue placeholder="Select relationship" />
              </SelectTrigger>
              <SelectContent>
                {RELATIONSHIP_ITEMS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={forSomeoneElse ? "Their phone" : "Phone number"}
          htmlFor="injuredPhone"
        >
          <Input
            id="injuredPhone"
            type="tel"
            inputMode="tel"
            autoComplete={forSomeoneElse ? undefined : "tel"}
            placeholder="(555) 555-5555"
            value={values.injuredPhone}
            onChange={(event) =>
              update("injuredPhone", formatPhone(event.target.value))
            }
            className="h-11"
          />
        </Field>
        <Field
          label={forSomeoneElse ? "Their email" : "Email address"}
          htmlFor="injuredEmail"
        >
          <Input
            id="injuredEmail"
            type="email"
            autoComplete={forSomeoneElse ? undefined : "email"}
            placeholder="you@example.com"
            value={values.injuredEmail}
            onChange={(event) => update("injuredEmail", event.target.value)}
            className="h-11"
          />
        </Field>
      </div>
    </>
  );
}

/** The submitter's details — required, only asked when filing for someone else. */
function FillerStep({ values, update }: StepProps) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="fillerFirstName">
          <Input
            id="fillerFirstName"
            autoComplete="given-name"
            placeholder="e.g. Jane"
            value={values.fillerFirstName}
            onChange={(event) => update("fillerFirstName", event.target.value)}
            className="h-11"
          />
        </Field>
        <Field label="Last name" htmlFor="fillerLastName">
          <Input
            id="fillerLastName"
            autoComplete="family-name"
            placeholder="e.g. Doe"
            value={values.fillerLastName}
            onChange={(event) => update("fillerLastName", event.target.value)}
            className="h-11"
          />
        </Field>
      </div>

      <Field label="Phone number" htmlFor="fillerPhone">
        <Input
          id="fillerPhone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(555) 555-5555"
          value={values.fillerPhone}
          onChange={(event) =>
            update("fillerPhone", formatPhone(event.target.value))
          }
          className="h-11"
        />
      </Field>

      <Field label="Email address" htmlFor="fillerEmail">
        <Input
          id="fillerEmail"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={values.fillerEmail}
          onChange={(event) => update("fillerEmail", event.target.value)}
          className="h-11"
        />
      </Field>
    </>
  );
}

/* -------------------------------------------------------------- success */

function IntakeSuccess({ firstName }: { firstName: string }) {
  return (
    <Card className="w-full overflow-hidden">
      <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
        <span className="flex size-14 animate-in items-center justify-center rounded-full bg-primary/10 text-primary duration-300 fade-in-0 zoom-in-50">
          <Check className="size-7" />
        </span>
        <h2 className="text-xl font-semibold tracking-tight text-balance">
          {firstName ? `Thanks, ${firstName}` : "Thank you"}
        </h2>
        <p className="max-w-sm text-sm text-muted-foreground text-pretty">
          We&apos;ve received your information. A member of our team will
          contact you shortly.
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------ container */

export function IntakeForm() {
  const [step, setStep] = React.useState(0);
  const [values, setValues] = React.useState<IntakeValues>(INITIAL_VALUES);
  const [direction, setDirection] = React.useState<"forward" | "back">(
    "forward",
  );
  const [status, setStatus] = React.useState<"idle" | "submitting" | "done">(
    "idle",
  );
  const [formError, setFormError] = React.useState<string | null>(null);
  // Ad tracking is read from the landing URL lazily, in event handlers only, so
  // the server and client markup stay identical on first paint.
  const utmRef = React.useRef<UtmParams | null>(null);
  const [campaignPreset, setCampaignPreset] = React.useState<
    IntakeValues["caseType"] | null
  >(null);

  function currentUtm(): UtmParams {
    if (!utmRef.current) {
      utmRef.current = readUtmParams(
        new URLSearchParams(window.location.search),
      );
    }
    return utmRef.current;
  }

  // Steps vary with the answers (filing for self skips the submitter step).
  const stepKeys = getStepKeys(values);
  const index = Math.min(step, stepKeys.length - 1);
  const currentKey = stepKeys[index];
  const meta = stepMeta(currentKey, values);
  // The note only makes sense while the campaign's choice is still selected.
  const autoSelected =
    currentKey === "caseType" &&
    campaignPreset !== null &&
    values.caseType === campaignPreset;
  const canContinue = isStepComplete(currentKey, values);
  const isLastStep = index === stepKeys.length - 1;
  const submitting = status === "submitting";

  function update<K extends keyof IntakeValues>(
    key: K,
    value: IntakeValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function stepBy(delta: number) {
    // The ad campaign choices the case type the first time that step is shown.
    // Preselect only; a value already chosen is left alone.
    if (delta > 0 && currentKey === "fillingFor") {
      const fromCampaign = caseTypeFromCampaign(currentUtm().campaign);
      if (fromCampaign) {
        setCampaignPreset(fromCampaign);
        setValues((prev) =>
          prev.caseType ? prev : { ...prev, caseType: fromCampaign },
        );
      }
    }
    setDirection(delta >= 0 ? "forward" : "back");
    setStep(Math.max(0, Math.min(stepKeys.length - 1, index + delta)));
  }

  async function submitLead() {
    setStatus("submitting");
    setFormError(null);
    try {
      const response = await fetch("/api/public/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildIntakeSubmission(values, currentUtm())),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          errors?: Record<string, string>;
        } | null;
        setFormError(
          payload?.error ?? "Something went wrong. Please try again.",
        );
        // Send the user back to the first step that needs attention.
        const step = payload?.errors
          ? firstErrorStep(payload.errors, stepKeys)
          : null;
        if (step) {
          const target = stepKeys.indexOf(step);
          if (target !== -1) {
            setDirection(target < index ? "back" : "forward");
            setStep(target);
          }
        }
        setStatus("idle");
        return;
      }
      setStatus("done");
    } catch {
      setFormError("We couldn't reach the server. Please try again.");
      setStatus("idle");
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLastStep) {
      if (canContinue) stepBy(1);
      return;
    }
    if (canContinue && !submitting) void submitLead();
  }

  if (status === "done") {
    const firstName =
      values.isFillingForSomeoneElse === true
        ? values.fillerFirstName
        : values.injuredFirstName;
    return <IntakeSuccess firstName={firstName} />;
  }

  const stepProps: StepProps = { values, update };

  return (
    <Card className="w-full overflow-hidden">
      <CardContent className="flex flex-col gap-6 p-5 sm:p-7">
        <StepHeader
          title={meta.title}
          subtitle={autoSelected ? AUTO_SELECTED_NOTE : meta.subtitle}
        />

        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex flex-col gap-6"
        >
          <div
            key={currentKey}
            className={cn(
              "flex flex-col gap-5 duration-300",
              "animate-in fade-in-0",
              direction === "forward"
                ? "slide-in-from-right-4"
                : "slide-in-from-left-4",
            )}
          >
            {currentKey === "fillingFor" ? (
              <FillingForStep {...stepProps} />
            ) : null}
            {currentKey === "caseType" ? <CaseTypeStep {...stepProps} /> : null}
            {currentKey === "whenWhere" ? (
              <WhenWhereStep {...stepProps} />
            ) : null}
            {currentKey === "incident" ? <IncidentStep {...stepProps} /> : null}
            {currentKey === "questions" ? (
              <QuestionsStep {...stepProps} />
            ) : null}
            {currentKey === "injured" ? <InjuredStep {...stepProps} /> : null}
            {currentKey === "filler" ? <FillerStep {...stepProps} /> : null}
          </div>

          {formError ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => stepBy(-1)}
              className={cn(index === 0 && "invisible")}
              disabled={submitting}
            >
              <ArrowLeft />
              Back
            </Button>

            {isLastStep ? (
              <Button
                type="submit"
                size="lg"
                disabled={!canContinue || submitting}
              >
                {submitting ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <ShieldCheck />
                )}
                {submitting ? "Submitting…" : "Submit"}
              </Button>
            ) : (
              <Button type="submit" size="lg" disabled={!canContinue}>
                Continue
                <ArrowRight />
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
