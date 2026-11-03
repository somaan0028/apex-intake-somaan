"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import {
  Field,
  OptionCards,
  StepHeader,
  YesNoField,
} from "./fields";
import {
  CASE_TYPE_OPTIONS,
  FILLING_FOR_OPTIONS,
  INITIAL_VALUES,
  formatPhone,
  getStepKeys,
  isStepComplete,
  stepMeta,
  type IntakeValues,
  type UpdateFn,
} from "./types";

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

/* ------------------------------------------------------------------ steps */

function FillingForStep({ values, update }: StepProps) {
  return (
    <OptionCards
      name="fillingFor"
      value={values.fillingFor}
      onChange={(value) => update("fillingFor", value)}
      options={FILLING_FOR_OPTIONS}
      columns={2}
    />
  );
}

function CaseTypeStep({ values, update }: StepProps) {
  return (
    <OptionCards
      name="caseType"
      value={values.caseType}
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
        htmlFor="incidentDate"
        hint="An approximate date is fine."
      >
        <Input
          id="incidentDate"
          type="date"
          max={today || undefined}
          value={values.incidentDate}
          onChange={(event) => update("incidentDate", event.target.value)}
          className="h-11"
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
        <Field label="ZIP code" htmlFor="postcode" optional>
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
        htmlFor="description"
      >
        <Textarea
          id="description"
          rows={4}
          placeholder={
            isMva
              ? "I was rear-ended at a red light…"
              : "I was prescribed… and started noticing…"
          }
          value={values.description}
          onChange={(event) => update("description", event.target.value)}
        />
      </Field>

      <Field
        label={isMva ? "What injuries did you suffer?" : "How were you harmed?"}
        htmlFor="howHurt"
        optional
      >
        <Textarea
          id="howHurt"
          rows={3}
          placeholder={
            isMva
              ? "For example: neck and back injuries."
              : "For example: back pain, a skin reaction, or a diagnosed condition."
          }
          value={values.howHurt}
          onChange={(event) => update("howHurt", event.target.value)}
        />
      </Field>
    </>
  );
}

function QuestionsStep({ values, update }: StepProps) {
  const isMva = values.caseType === "MVA";
  const forSomeoneElse = values.fillingFor === "SomeoneElse";

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
          name="atFault"
          value={values.atFault}
          onChange={(value) => update("atFault", value)}
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
          name="receivedSettlement"
          value={values.receivedSettlement}
          onChange={(value) => update("receivedSettlement", value)}
        />
      </Field>
    </>
  );
}

/** The injured person's details. For the submitter too when filing for self. */
function InjuredStep({ values, update }: StepProps) {
  const forSomeoneElse = values.fillingFor === "SomeoneElse";

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
            value={values.injuredFirstName}
            onChange={(event) =>
              update("injuredFirstName", event.target.value)
            }
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
            value={values.injuredLastName}
            onChange={(event) => update("injuredLastName", event.target.value)}
            className="h-11"
          />
        </Field>
      </div>

      {forSomeoneElse ? (
        <Field label="How are they related to you?" htmlFor="relationship">
          <Select
            items={RELATIONSHIP_ITEMS}
            value={values.relationship || null}
            onValueChange={(value) => update("relationship", value ?? "")}
          >
            <SelectTrigger id="relationship" className="h-11 w-full">
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
        </Field>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={forSomeoneElse ? "Their phone" : "Phone number"}
          htmlFor="injuredPhone"
          optional={forSomeoneElse}
          hint={
            forSomeoneElse ? undefined : "We'll text or call to follow up."
          }
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
          optional={forSomeoneElse}
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

/** The submitter's details — only shown when filing for someone else. */
function FillerStep({ values, update }: StepProps) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="firstName">
          <Input
            id="firstName"
            autoComplete="given-name"
            value={values.firstName}
            onChange={(event) => update("firstName", event.target.value)}
            className="h-11"
          />
        </Field>
        <Field label="Last name" htmlFor="lastName">
          <Input
            id="lastName"
            autoComplete="family-name"
            value={values.lastName}
            onChange={(event) => update("lastName", event.target.value)}
            className="h-11"
          />
        </Field>
      </div>

      <Field
        label="Phone number"
        htmlFor="phone"
        hint="We'll text or call to follow up."
      >
        <Input
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(555) 555-5555"
          value={values.phone}
          onChange={(event) => update("phone", formatPhone(event.target.value))}
          className="h-11"
        />
      </Field>

      <Field label="Email address" htmlFor="email">
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={values.email}
          onChange={(event) => update("email", event.target.value)}
          className="h-11"
        />
      </Field>
    </>
  );
}

/* -------------------------------------------------------------- success */

function IntakeSuccess({
  firstName,
  onReset,
}: {
  firstName: string;
  onReset: () => void;
}) {
  return (
    <Card className="w-full overflow-hidden">
      <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
        <span className="flex size-14 animate-in items-center justify-center rounded-full bg-primary/10 text-primary duration-300 fade-in-0 zoom-in-50">
          <Check className="size-7" />
        </span>
        <h2 className="text-xl font-semibold tracking-tight text-balance">
          {firstName ? `Thanks, ${firstName} — you're all set` : "You're all set"}
        </h2>
        <p className="max-w-sm text-sm text-muted-foreground text-pretty">
          We&apos;ve got what we need. A member of our intake team will reach out
          shortly.
        </p>
        <p className="text-xs text-muted-foreground">
          Keep an eye on your phone and email.
        </p>
        <Button type="button" variant="outline" onClick={onReset}>
          Start over
        </Button>
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
  const [submitted, setSubmitted] = React.useState(false);

  // Steps vary with the answers (filing for self skips the submitter step).
  const stepKeys = getStepKeys(values);
  const index = Math.min(step, stepKeys.length - 1);
  const currentKey = stepKeys[index];
  const meta = stepMeta(currentKey, values);
  const canContinue = isStepComplete(currentKey, values);
  const isLastStep = index === stepKeys.length - 1;

  function update<K extends keyof IntakeValues>(
    key: K,
    value: IntakeValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function stepBy(delta: number) {
    setDirection(delta >= 0 ? "forward" : "back");
    setStep(Math.max(0, Math.min(stepKeys.length - 1, index + delta)));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLastStep) {
      if (canContinue) stepBy(1);
      return;
    }
    // TODO(submit): validate, build the lead payload and persist it to the DB.
    //   Intentionally not wired up yet — this is the UI pass.
    setSubmitted(true);
  }

  if (submitted) {
    const firstName =
      values.fillingFor === "SomeoneElse"
        ? values.firstName
        : values.injuredFirstName;
    return (
      <IntakeSuccess
        firstName={firstName}
        onReset={() => {
          setValues(INITIAL_VALUES);
          setDirection("forward");
          setStep(0);
          setSubmitted(false);
        }}
      />
    );
  }

  const stepProps: StepProps = { values, update };

  return (
    <Card className="w-full overflow-hidden">
      <CardContent className="flex flex-col gap-6 p-5 sm:p-7">
        <StepHeader title={meta.title} subtitle={meta.subtitle} />

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
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

          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => stepBy(-1)}
              className={cn(index === 0 && "invisible")}
            >
              <ArrowLeft />
              Back
            </Button>

            {isLastStep ? (
              <Button type="submit" size="lg" disabled={!canContinue}>
                <ShieldCheck />
                Submit my claim
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
