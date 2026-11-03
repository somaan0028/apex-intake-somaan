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
import { STATE_NAME_BY_CODE, US_STATES } from "@/lib/us-states";
import { COUNTIES_BY_STATE } from "@/lib/us-counties";
import { RELATIONSHIP_LABELS, relationshipLabel } from "@/lib/labels";
import {
  Field,
  OptionCards,
  ReviewRow,
  ReviewSection,
  StepHeader,
  YesNoField,
} from "./fields";
import {
  CAMPAIGN_OPTIONS,
  FILLING_FOR_OPTIONS,
  INITIAL_VALUES,
  STEP_COUNT,
  STEP_INDEX,
  STEPS,
  formatDisplayDate,
  formatPhone,
  isStepComplete,
  type IntakeValues,
  type UpdateFn,
} from "./types";

interface StepProps {
  values: IntakeValues;
  update: UpdateFn;
  goTo: (step: number) => void;
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

function CampaignStep({ values, update }: StepProps) {
  return (
    <OptionCards
      name="campaign"
      value={values.campaign}
      onChange={(value) => update("campaign", value)}
      options={CAMPAIGN_OPTIONS}
    />
  );
}

function WhenWhereStep({ values, update }: StepProps) {
  const isMva = values.campaign === "MVA";

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
  const isMva = values.campaign === "MVA";

  return (
    <>
      <Field
        label={
          isMva
            ? "How were you hurt?"
            : "What product or medication harmed you?"
        }
        htmlFor="howHurt"
        optional
        hint={isMva ? "For example: neck and back injuries." : undefined}
      >
        <Textarea
          id="howHurt"
          rows={3}
          value={values.howHurt}
          onChange={(event) => update("howHurt", event.target.value)}
        />
      </Field>

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
    </>
  );
}

function QuestionsStep({ values, update }: StepProps) {
  const isMva = values.campaign === "MVA";

  return (
    <>
      {isMva ? (
        <Field label="Were you at fault for the accident?">
          <YesNoField
            name="atFault"
            value={values.atFault}
            onChange={(value) => update("atFault", value)}
          />
        </Field>
      ) : null}

      <Field label="Do you already have an attorney?">
        <YesNoField
          name="hasAttorney"
          value={values.hasAttorney}
          onChange={(value) => update("hasAttorney", value)}
        />
      </Field>

      <Field label="Have you received any settlement or insurance payment?">
        <YesNoField
          name="receivedSettlement"
          value={values.receivedSettlement}
          onChange={(value) => update("receivedSettlement", value)}
        />
      </Field>
    </>
  );
}

function ForWhomStep({ values, update }: StepProps) {
  const onBehalf = values.fillingFor === "SomeoneElse";

  return (
    <>
      <OptionCards
        name="fillingFor"
        value={values.fillingFor}
        onChange={(value) => update("fillingFor", value)}
        options={FILLING_FOR_OPTIONS}
        columns={2}
      />

      {onBehalf ? (
        <div className="flex animate-in flex-col gap-5 rounded-xl border border-input bg-muted/30 p-4 duration-300 fade-in-0 slide-in-from-top-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Their first name" htmlFor="injuredFirstName">
              <Input
                id="injuredFirstName"
                value={values.injuredFirstName}
                onChange={(event) =>
                  update("injuredFirstName", event.target.value)
                }
                className="h-11"
              />
            </Field>
            <Field label="Their last name" htmlFor="injuredLastName">
              <Input
                id="injuredLastName"
                value={values.injuredLastName}
                onChange={(event) =>
                  update("injuredLastName", event.target.value)
                }
                className="h-11"
              />
            </Field>
          </div>

          <Field label="Your relationship to them" htmlFor="relationship">
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

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Their phone" htmlFor="injuredPhone" optional>
              <Input
                id="injuredPhone"
                type="tel"
                inputMode="tel"
                value={values.injuredPhone}
                onChange={(event) =>
                  update("injuredPhone", formatPhone(event.target.value))
                }
                className="h-11"
              />
            </Field>
            <Field label="Their email" htmlFor="injuredEmail" optional>
              <Input
                id="injuredEmail"
                type="email"
                value={values.injuredEmail}
                onChange={(event) =>
                  update("injuredEmail", event.target.value)
                }
                className="h-11"
              />
            </Field>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ContactStep({ values, update }: StepProps) {
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
        hint="We'll text or call about your free case review."
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

function ReviewStep({ values, goTo }: StepProps) {
  const isMva = values.campaign === "MVA";
  const onBehalf = values.fillingFor === "SomeoneElse";

  const location = [
    STATE_NAME_BY_CODE[values.state],
    values.county,
    values.postcode,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex flex-col gap-3">
      <ReviewSection title="Your case" onEdit={() => goTo(STEP_INDEX.campaign)}>
        <ReviewRow label="Type" value={values.campaign} />
        <ReviewRow
          label="Date"
          value={formatDisplayDate(values.incidentDate)}
        />
        <ReviewRow label="Location" value={location} />
      </ReviewSection>

      <ReviewSection
        title="What happened"
        onEdit={() => goTo(STEP_INDEX.incident)}
      >
        {values.howHurt ? (
          <ReviewRow label="Injuries" value={values.howHurt} />
        ) : null}
        <ReviewRow label="Details" value={values.description} />
        {isMva ? (
          <ReviewRow label="At fault" value={values.atFault} />
        ) : null}
      </ReviewSection>

      <ReviewSection title="Claims" onEdit={() => goTo(STEP_INDEX.questions)}>
        <ReviewRow label="Has attorney" value={values.hasAttorney} />
        <ReviewRow
          label="Settlement"
          value={values.receivedSettlement}
        />
      </ReviewSection>

      <ReviewSection title="Who it's for" onEdit={() => goTo(STEP_INDEX.forWhom)}>
        <ReviewRow
          label="Filing for"
          value={onBehalf ? "Someone else" : "Myself"}
        />
        {onBehalf ? (
          <>
            <ReviewRow
              label="Injured person"
              value={`${values.injuredFirstName} ${values.injuredLastName}`.trim()}
            />
            <ReviewRow
              label="Relationship"
              value={relationshipLabel(values.relationship)}
            />
            {values.injuredPhone ? (
              <ReviewRow label="Their phone" value={values.injuredPhone} />
            ) : null}
            {values.injuredEmail ? (
              <ReviewRow label="Their email" value={values.injuredEmail} />
            ) : null}
          </>
        ) : null}
      </ReviewSection>

      <ReviewSection title="Contact" onEdit={() => goTo(STEP_INDEX.contact)}>
        <ReviewRow
          label="Name"
          value={`${values.firstName} ${values.lastName}`.trim()}
        />
        <ReviewRow label="Phone" value={values.phone} />
        <ReviewRow label="Email" value={values.email} />
      </ReviewSection>
    </div>
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
          shortly to walk you through your free case review.
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

  function update<K extends keyof IntakeValues>(
    key: K,
    value: IntakeValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function goTo(next: number) {
    setDirection(next >= step ? "forward" : "back");
    setStep(Math.max(0, Math.min(STEP_COUNT - 1, next)));
  }

  const canContinue = isStepComplete(step, values);
  const isLastStep = step === STEP_COUNT - 1;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLastStep) {
      if (canContinue) goTo(step + 1);
      return;
    }
    // TODO(submit): validate, build the lead payload and persist it to the DB.
    //   Intentionally not wired up yet — this is the UI pass.
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <IntakeSuccess
        firstName={values.firstName}
        onReset={() => {
          setValues(INITIAL_VALUES);
          setDirection("forward");
          setStep(0);
          setSubmitted(false);
        }}
      />
    );
  }

  const stepProps: StepProps = { values, update, goTo };

  return (
    <Card className="w-full overflow-hidden">
      <CardContent className="flex flex-col gap-6 p-5 sm:p-7">
        <StepHeader
          index={step}
          total={STEP_COUNT}
          title={STEPS[step].title}
          subtitle={STEPS[step].subtitle}
        />

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
          <div
            key={step}
            className={cn(
              "flex flex-col gap-5 duration-300",
              "animate-in fade-in-0",
              direction === "forward"
                ? "slide-in-from-right-4"
                : "slide-in-from-left-4",
            )}
          >
            {step === STEP_INDEX.campaign ? <CampaignStep {...stepProps} /> : null}
            {step === STEP_INDEX.whenWhere ? <WhenWhereStep {...stepProps} /> : null}
            {step === STEP_INDEX.incident ? <IncidentStep {...stepProps} /> : null}
            {step === STEP_INDEX.questions ? <QuestionsStep {...stepProps} /> : null}
            {step === STEP_INDEX.forWhom ? <ForWhomStep {...stepProps} /> : null}
            {step === STEP_INDEX.contact ? <ContactStep {...stepProps} /> : null}
            {step === STEP_INDEX.review ? <ReviewStep {...stepProps} /> : null}
          </div>

          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => goTo(step - 1)}
              className={cn(step === 0 && "invisible")}
            >
              <ArrowLeft />
              Back
            </Button>

            {isLastStep ? (
              <Button type="submit" size="lg">
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
