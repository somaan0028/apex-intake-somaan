"use client";

/**
 * Auto-saving detail dialog for a lead.
 *
 * The stage, assignment and every day-to-day field save as they change: there
 * is no Save button. Text fields are debounced, selects and the date save
 * immediately, and the footer reports "Saving…" / "Saved". The Lawmatics id,
 * the attribution block and the Brightwater submission facts stay read-only
 * because the systems that produced them own them.
 *
 * Which field is editable comes from the same RBAC policies the Server Action
 * enforces, so the controls never offer something the server would reject:
 *
 *   - an admin may edit and assign any lead;
 *   - an agent may edit a lead they own, and may claim an unassigned lead (or
 *     release one they own) with a button rather than an assignee dropdown.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import { LEAD_STAGES, RELATIONSHIPS, type LeadStage } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";
import {
  LEAD_STAGE_LABELS,
  RELATIONSHIP_LABELS,
  assigneeLabel,
} from "@/lib/labels";
import { sendLeadToFirm } from "@/lib/leads/actions";
import { UNASSIGNED } from "@/lib/leads/constants";
import type { LeadFieldPatch } from "@/lib/leads/editable";
import type { LeadRow } from "@/lib/leads/queries";
import {
  SEND_READY_STAGE,
  can,
  canAssignLead,
  canChangeLeadStage,
  canEditLead,
  canSendLeadToFirm,
  type Actor,
} from "@/lib/rbac";
import { COUNTIES_BY_STATE } from "@/lib/us-counties";
import { US_STATES } from "@/lib/us-states";
import { useLeadAutoSave, type SaveStatus } from "./use-lead-autosave";

const STAGE_OPTIONS = LEAD_STAGES.map((value) => ({
  label: LEAD_STAGE_LABELS[value],
  value,
}));

/** Sentinel for "not set" in the state/county selects. */
const NONE = "__none__";

const STATE_OPTIONS = [
  { label: "Not set", value: NONE },
  ...US_STATES.map((state) => ({
    label: `${state.name} (${state.code})`,
    value: state.code,
  })),
];

const TRI_STATE_OPTIONS = [
  { label: "Unknown", value: "unknown" },
  { label: "Yes", value: "yes" },
  { label: "No", value: "no" },
];

const RELATIONSHIP_OPTIONS = [
  { label: "Not set", value: NONE },
  ...RELATIONSHIPS.map((relationship) => ({
    label: RELATIONSHIP_LABELS[relationship],
    value: relationship,
  })),
];

/** A value that may be missing, rendered as a dash. */
function orDash(value: string | null | undefined): ReactNode {
  return value ? value : <span className="text-muted-foreground">—</span>;
}

/** The picker's string for a nullable boolean. */
function triStateValue(value: boolean | null): string {
  return value === null ? "unknown" : value ? "yes" : "no";
}

function triStateFromValue(value: string): boolean | null {
  return value === "unknown" ? null : value === "yes";
}

/**
 * `YYYY-MM-DD` for the picker. Accident dates are stored at UTC midnight, so
 * reading them back with UTC keeps the day the intake form captured.
 */
function toIsoDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

/** One read-only field inside a `Section`. */
function Field({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={wide ? "col-span-2 grid min-w-0 gap-1" : "grid min-w-0 gap-1"}
    >
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

/** A titled group of read-only fields. */
function Section({
  title,
  columns = 2,
  className,
  children,
}: {
  title: string;
  columns?: 2 | 3 | 4;
  className?: string;
  children: ReactNode;
}) {
  const columnClass =
    columns === 4 ? "lg:grid-cols-4" : columns === 3 ? "lg:grid-cols-3" : "";
  return (
    <section className={className ? `grid gap-3 ${className}` : "grid gap-3"}>
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <dl className={`grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 ${columnClass}`}>
        {children}
      </dl>
    </section>
  );
}

/** A labelled editable control. */
function FormField({
  label,
  htmlFor,
  hint,
  wide,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? "grid gap-1.5 sm:col-span-2" : "grid gap-1.5"}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** The Google-Docs-style save state shown in the footer. */
function SaveState({ status }: { status: SaveStatus }) {
  if (status === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="size-3" />
        Saved
      </span>
    );
  }
  return null;
}

interface Draft {
  injuredFirstName: string;
  injuredLastName: string;
  injuredPhone: string;
  injuredEmail: string;
  fillerFirstName: string;
  fillerLastName: string;
  fillerPhone: string;
  fillerEmail: string;
  relationshipToInjured: string;
  dateOfAccident: string;
  state: string;
  county: string;
  postcode: string;
  injuryDetails: string;
  accidentDetails: string;
  isAtFault: boolean | null;
  hasAttorney: boolean | null;
  hasReceivedSettlement: boolean | null;
}

type TextField =
  | "injuredFirstName"
  | "injuredLastName"
  | "injuredPhone"
  | "injuredEmail"
  | "fillerFirstName"
  | "fillerLastName"
  | "fillerPhone"
  | "fillerEmail"
  | "postcode"
  | "injuryDetails"
  | "accidentDetails";

type TriStateField = "isAtFault" | "hasAttorney" | "hasReceivedSettlement";

export function LeadDialog({
  lead,
  onClose,
  viewer,
  assignees,
}: {
  /** The lead to show, or `null` when the dialog is closed. */
  lead: LeadRow | null;
  onClose: () => void;
  /** The signed-in user, for the policy checks. */
  viewer: Actor;
  /** Who the viewer may assign a lead to (admins: everyone, agents: themselves). */
  assignees: Array<{ id: number; name: string }>;
}) {
  // Unmounting when closed keeps the form state fresh for the next open.
  if (!lead) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl lg:max-w-6xl">
        <LeadForm
          key={lead.id}
          lead={lead}
          viewer={viewer}
          assignees={assignees}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

function LeadForm({
  lead,
  viewer,
  assignees,
  onClose,
}: {
  lead: LeadRow;
  viewer: Actor;
  assignees: Array<{ id: number; name: string }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [sending, startSending] = useTransition();
  const { status, error, saveNow, schedule, flush, flushAll } = useLeadAutoSave(
    lead.id,
  );

  const [stage, setStage] = useState<LeadStage>(lead.stage);
  const [assignedToId, setAssignedToId] = useState<number | null>(
    lead.assignedToId,
  );

  // Firm-submission facts live in local state so a successful send shows in the
  // form immediately, without waiting for the grid refresh to round-trip.
  const [sentAt, setSentAt] = useState<Date | null>(lead.sentToFirmAt);
  const [brightwaterLeadId, setBrightwaterLeadId] = useState<string | null>(
    lead.brightwaterLeadId,
  );

  const [draft, setDraft] = useState<Draft>(() => ({
    injuredFirstName: lead.injuredFirstName ?? "",
    injuredLastName: lead.injuredLastName ?? "",
    injuredPhone: lead.injuredPhone ?? "",
    injuredEmail: lead.injuredEmail ?? "",
    fillerFirstName: lead.fillerFirstName ?? "",
    fillerLastName: lead.fillerLastName ?? "",
    fillerPhone: lead.fillerPhone ?? "",
    fillerEmail: lead.fillerEmail ?? "",
    relationshipToInjured: lead.relationshipToInjured ?? "",
    dateOfAccident: toIsoDate(lead.dateOfAccident),
    state: lead.state ?? "",
    county: lead.county ?? "",
    postcode: lead.postcode ?? "",
    injuryDetails: lead.injuryDetails ?? "",
    accidentDetails: lead.accidentDetails ?? "",
    isAtFault: lead.isAtFault,
    hasAttorney: lead.hasAttorney,
    hasReceivedSettlement: lead.hasReceivedSettlement,
  }));

  // The policy subject tracks local edits, so claiming a lead enables editing
  // without waiting for the grid refresh.
  const subject = {
    ...lead,
    stage,
    assignedToId,
    sentToFirmAt: sentAt,
    brightwaterLeadId,
  };

  const canEdit = canEditLead(viewer, subject);
  const canSeeAttribution = can(viewer.role, "leads.view.attribution");
  const canAssignAny = can(viewer.role, "leads.assign.any");
  const canClaim = canAssignLead(viewer, subject, viewer.id);
  const canRelease = canAssignLead(viewer, subject, null);
  const sent = sentAt !== null || brightwaterLeadId !== null;
  const canSend = canSendLeadToFirm(viewer, subject);

  const today = new Date().toISOString().slice(0, 10);

  const currentAssignee =
    assignedToId === null ? UNASSIGNED : String(assignedToId);
  // The options are exactly what this viewer may set: admins get the whole team.
  const assigneeOptions = [
    { label: "Unassigned", value: UNASSIGNED },
    ...assignees.map((assignee) => ({
      label: assigneeLabel(assignee, viewer.id),
      value: String(assignee.id),
    })),
  ];
  // Safety net: keep the current owner visible even if they aren't an option,
  // e.g. an admin reassigned the lead after this dialog was opened.
  if (
    assignedToId !== null &&
    !assignees.some((assignee) => assignee.id === assignedToId)
  ) {
    assigneeOptions.push({
      label: lead.assignedToName ?? `User #${assignedToId}`,
      value: String(assignedToId),
    });
  }

  const counties = draft.state ? (COUNTIES_BY_STATE[draft.state] ?? []) : [];
  const countyOptions = [
    { label: "Not set", value: NONE },
    ...counties.map((county) => ({ label: county, value: county })),
  ];

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  /** Update a text field and debounce its save. */
  function changeText(key: TextField, value: string) {
    updateDraft(key, value);
    schedule(key, { [key]: value } as LeadFieldPatch);
  }

  async function changeStage(value: LeadStage) {
    const previous = stage;
    setStage(value);
    const ok = await saveNow({ stage: value });
    if (!ok) setStage(previous);
  }

  async function changeAssignee(value: string) {
    const next = value === UNASSIGNED ? null : Number(value);
    const previous = assignedToId;
    setAssignedToId(next);
    const ok = await saveNow({ assignedToId: next });
    if (!ok) setAssignedToId(previous);
  }

  async function claimLead() {
    const previous = assignedToId;
    setAssignedToId(viewer.id);
    const ok = await saveNow({ assignedToId: viewer.id });
    if (!ok) setAssignedToId(previous);
  }

  async function releaseLead() {
    const previous = assignedToId;
    setAssignedToId(null);
    const ok = await saveNow({ assignedToId: null });
    if (!ok) setAssignedToId(previous);
  }

  function changeTriState(key: TriStateField, value: string) {
    const next = triStateFromValue(value);
    updateDraft(key, next);
    void saveNow({ [key]: next } as LeadFieldPatch);
  }

  function changeState(value: string) {
    const nextState = value === NONE ? "" : value;
    // A county from the old state is not a valid answer for the new one.
    const nextCounties = nextState ? (COUNTIES_BY_STATE[nextState] ?? []) : [];
    const nextCounty = nextCounties.includes(draft.county) ? draft.county : "";
    setDraft((prev) => ({
      ...prev,
      state: nextState,
      county: nextCounty,
    }));
    void saveNow({ state: nextState, county: nextCounty });
  }

  function changeCounty(value: string) {
    const county = value === NONE ? "" : value;
    updateDraft("county", county);
    void saveNow({ county });
  }

  function changeRelationship(value: string) {
    const relationship = value === NONE ? "" : value;
    updateDraft("relationshipToInjured", relationship);
    void saveNow({ relationshipToInjured: relationship });
  }

  function changeDate(value: string) {
    updateDraft("dateOfAccident", value);
    void saveNow({ dateOfAccident: value });
  }

  /** Close after sending any debounced edits that are still waiting. */
  function handleClose() {
    flushAll();
    onClose();
  }

  /** Send to Brightwater, then reflect the result here and in the grid. */
  async function handleSend() {
    // The firm only takes retained leads; explain rather than fire a doomed
    // request. The server re-checks the persisted stage either way.
    if (stage !== SEND_READY_STAGE) {
      toast.warning("Lead is not retained", {
        description: "Move the lead to Retained before sending it to the firm.",
      });
      return;
    }

    // The server reads the saved stage, so make sure a just-chosen "Retained"
    // has reached the database before the firm request runs.
    if (stage !== lead.stage) {
      const saved = await saveNow({ stage });
      if (!saved) return;
    }

    const formData = new FormData();
    formData.set("id", String(lead.id));

    startSending(async () => {
      const result = await sendLeadToFirm(formData);
      if (!result.ok) {
        toast.error("Could not send to firm", {
          description: result.error ?? "Please try again.",
        });
        return;
      }

      const sentTime = result.sentToFirmAt
        ? new Date(result.sentToFirmAt)
        : new Date();
      setSentAt(sentTime);
      setBrightwaterLeadId(result.brightwaterLeadId ?? null);
      setStage("SENT_TO_FIRM");
      toast.success("Lead sent to firm", {
        description: result.brightwaterLeadId
          ? `Brightwater accepted the lead (id ${result.brightwaterLeadId}).`
          : "Brightwater accepted the lead.",
      });
      router.refresh();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {[lead.injuredFirstName, lead.injuredLastName]
            .filter(Boolean)
            .join(" ") || "Lead details"}
        </DialogTitle>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="grid max-h-[calc(100svh-10rem)] gap-4 overflow-y-auto pr-1 sm:max-h-[calc(100svh-8rem)] lg:grid-cols-12 lg:items-start lg:gap-x-6">
          {/* Stage + assignment. */}
          <section className="grid gap-3 lg:col-span-3">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Case
            </h3>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <FormField label="Stage" htmlFor="lead-stage">
                <Select
                  items={STAGE_OPTIONS}
                  value={stage}
                  onValueChange={(value) => {
                    if (value) void changeStage(value as LeadStage);
                  }}
                  disabled={!canEdit}
                >
                  <SelectTrigger id="lead-stage" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGE_OPTIONS.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        // The current stage stays selectable; anything the
                        // viewer can't move to (Sent to Firm, for an agent) is
                        // disabled.
                        disabled={
                          option.value !== stage &&
                          !canChangeLeadStage(viewer, subject, option.value)
                        }
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!canEdit ? (
                  <p className="text-xs text-muted-foreground">
                    Only the agent who owns this lead can edit it.
                  </p>
                ) : null}
              </FormField>

              <FormField
                label="Assigned to"
                htmlFor={canAssignAny ? "lead-assignee" : undefined}
              >
                {canAssignAny ? (
                  <Select
                    items={assigneeOptions}
                    value={currentAssignee}
                    onValueChange={(value) => {
                      if (value) void changeAssignee(value);
                    }}
                  >
                    <SelectTrigger id="lead-assignee" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {assigneeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : assignedToId === viewer.id && canRelease ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-start"
                    onClick={() => void releaseLead()}
                  >
                    Release
                  </Button>
                ) : assignedToId === null && canClaim ? (
                  <Button
                    type="button"
                    className="justify-start"
                    onClick={() => void claimLead()}
                  >
                    Claim
                  </Button>
                ) : (
                  <p className="text-sm">
                    {lead.assignedToName ?? `User #${assignedToId}`}
                  </p>
                )}
                {!canAssignAny && assignedToId === viewer.id && canRelease ? (
                  <p className="text-xs text-muted-foreground">
                    Assigned to you. Release it to return it to the pool.
                  </p>
                ) : null}
                {!canAssignAny && assignedToId === null && canClaim ? (
                  <p className="text-xs text-muted-foreground">
                    Claim this lead to edit it.
                  </p>
                ) : null}
              </FormField>
            </div>
          </section>

          {lead.isFillingForSomeoneElse ? (
            <section className="grid gap-3 lg:col-span-4">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Submitted by someone else
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label="First name" htmlFor="fillerFirstName">
                  <Input
                    id="fillerFirstName"
                    value={draft.fillerFirstName}
                    disabled={!canEdit}
                    onChange={(event) =>
                      changeText("fillerFirstName", event.target.value)
                    }
                    onBlur={() => flush("fillerFirstName")}
                  />
                </FormField>
                <FormField label="Last name" htmlFor="fillerLastName">
                  <Input
                    id="fillerLastName"
                    value={draft.fillerLastName}
                    disabled={!canEdit}
                    onChange={(event) =>
                      changeText("fillerLastName", event.target.value)
                    }
                    onBlur={() => flush("fillerLastName")}
                  />
                </FormField>
                <FormField label="Phone" htmlFor="fillerPhone">
                  <div className="flex items-center gap-1.5">
                    <Input
                      id="fillerPhone"
                      type="tel"
                      value={draft.fillerPhone}
                      disabled={!canEdit}
                      placeholder="(555) 555-5555"
                      className="min-w-0 flex-1"
                      onChange={(event) =>
                        changeText("fillerPhone", event.target.value)
                      }
                      onBlur={() => flush("fillerPhone")}
                    />
                    <CopyButton
                      value={draft.fillerPhone}
                      label="Phone"
                      size="icon-sm"
                    />
                  </div>
                </FormField>
                <FormField label="Email" htmlFor="fillerEmail">
                  <div className="flex items-center gap-1.5">
                    <Input
                      id="fillerEmail"
                      type="email"
                      value={draft.fillerEmail}
                      disabled={!canEdit}
                      placeholder="name@example.com"
                      className="min-w-0 flex-1"
                      onChange={(event) =>
                        changeText("fillerEmail", event.target.value)
                      }
                      onBlur={() => flush("fillerEmail")}
                    />
                    <CopyButton
                      value={draft.fillerEmail}
                      label="Email"
                      size="icon-sm"
                    />
                  </div>
                </FormField>
                <FormField label="Relationship" htmlFor="fillerRelationship">
                  <Select
                    items={RELATIONSHIP_OPTIONS}
                    value={draft.relationshipToInjured || NONE}
                    onValueChange={(value) => {
                      if (value) changeRelationship(value);
                    }}
                    disabled={!canEdit}
                  >
                    <SelectTrigger id="fillerRelationship" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RELATIONSHIP_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              </div>
            </section>
          ) : null}

          <section
            className={`grid gap-3 ${
              lead.isFillingForSomeoneElse ? "lg:col-span-5" : "lg:col-span-9"
            }`}
          >
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Injured person
            </h3>
            <div
              className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${
                lead.isFillingForSomeoneElse ? "" : "lg:grid-cols-3"
              }`}
            >
              <FormField label="First name" htmlFor="injuredFirstName">
                <Input
                  id="injuredFirstName"
                  value={draft.injuredFirstName}
                  disabled={!canEdit}
                  onChange={(event) =>
                    changeText("injuredFirstName", event.target.value)
                  }
                  onBlur={() => flush("injuredFirstName")}
                />
              </FormField>
              <FormField label="Last name" htmlFor="injuredLastName">
                <Input
                  id="injuredLastName"
                  value={draft.injuredLastName}
                  disabled={!canEdit}
                  onChange={(event) =>
                    changeText("injuredLastName", event.target.value)
                  }
                  onBlur={() => flush("injuredLastName")}
                />
              </FormField>
              <FormField label="Phone" htmlFor="injuredPhone">
                <div className="flex items-center gap-1.5">
                  <Input
                    id="injuredPhone"
                    type="tel"
                    value={draft.injuredPhone}
                    disabled={!canEdit}
                    placeholder="(555) 555-5555"
                    className="min-w-0 flex-1"
                    onChange={(event) =>
                      changeText("injuredPhone", event.target.value)
                    }
                    onBlur={() => flush("injuredPhone")}
                  />
                  <CopyButton
                    value={draft.injuredPhone}
                    label="Phone"
                    size="icon-sm"
                  />
                </div>
              </FormField>
              <FormField label="Email" htmlFor="injuredEmail">
                <div className="flex items-center gap-1.5">
                  <Input
                    id="injuredEmail"
                    type="email"
                    value={draft.injuredEmail}
                    disabled={!canEdit}
                    placeholder="name@example.com"
                    className="min-w-0 flex-1"
                    onChange={(event) =>
                      changeText("injuredEmail", event.target.value)
                    }
                    onBlur={() => flush("injuredEmail")}
                  />
                  <CopyButton
                    value={draft.injuredEmail}
                    label="Email"
                    size="icon-sm"
                  />
                </div>
              </FormField>
              <FormField label="Date of accident" htmlFor="dateOfAccident">
                <DatePicker
                  id="dateOfAccident"
                  value={draft.dateOfAccident}
                  max={today}
                  placeholder="Choose a date"
                  disabled={!canEdit}
                  className="h-8"
                  onChange={changeDate}
                />
              </FormField>
            </div>
          </section>

          <section className="grid gap-3 lg:col-span-3">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Location
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <FormField label="State" htmlFor="lead-state">
                <Select
                  items={STATE_OPTIONS}
                  value={draft.state || NONE}
                  onValueChange={(value) => {
                    if (value) changeState(value);
                  }}
                  disabled={!canEdit}
                >
                  <SelectTrigger id="lead-state" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="County" htmlFor="lead-county">
                <Select
                  items={countyOptions}
                  value={draft.county || NONE}
                  onValueChange={(value) => {
                    if (value) changeCounty(value);
                  }}
                  disabled={!canEdit || !draft.state}
                >
                  <SelectTrigger id="lead-county" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {countyOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!draft.state ? (
                  <p className="text-xs text-muted-foreground">
                    Choose a state first.
                  </p>
                ) : null}
              </FormField>
              <FormField label="ZIP code" htmlFor="lead-postcode">
                <Input
                  id="lead-postcode"
                  inputMode="numeric"
                  value={draft.postcode}
                  disabled={!canEdit}
                  placeholder="12345"
                  onChange={(event) =>
                    changeText("postcode", event.target.value)
                  }
                  onBlur={() => flush("postcode")}
                />
              </FormField>
            </div>
          </section>

          <section className="grid gap-3 lg:col-span-9">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Case facts
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="At fault" htmlFor="lead-at-fault">
                <Select
                  items={TRI_STATE_OPTIONS}
                  value={triStateValue(draft.isAtFault)}
                  onValueChange={(value) => {
                    if (value) changeTriState("isAtFault", value);
                  }}
                  disabled={!canEdit}
                >
                  <SelectTrigger id="lead-at-fault" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRI_STATE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Has attorney" htmlFor="lead-has-attorney">
                <Select
                  items={TRI_STATE_OPTIONS}
                  value={triStateValue(draft.hasAttorney)}
                  onValueChange={(value) => {
                    if (value) changeTriState("hasAttorney", value);
                  }}
                  disabled={!canEdit}
                >
                  <SelectTrigger id="lead-has-attorney" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRI_STATE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField
                label="Received settlement"
                htmlFor="lead-received-settlement"
              >
                <Select
                  items={TRI_STATE_OPTIONS}
                  value={triStateValue(draft.hasReceivedSettlement)}
                  onValueChange={(value) => {
                    if (value) changeTriState("hasReceivedSettlement", value);
                  }}
                  disabled={!canEdit}
                >
                  <SelectTrigger
                    id="lead-received-settlement"
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRI_STATE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Lawmatics ID">
                <p className="flex h-8 items-center text-sm">
                  {orDash(lead.matterId)}
                </p>
              </FormField>
              <FormField
                label="Injury details"
                htmlFor="lead-injury-details"
                wide
              >
                <Textarea
                  id="lead-injury-details"
                  value={draft.injuryDetails}
                  disabled={!canEdit}
                  className="min-h-16"
                  onChange={(event) =>
                    changeText("injuryDetails", event.target.value)
                  }
                  onBlur={() => flush("injuryDetails")}
                />
              </FormField>
              <FormField
                label="Accident details"
                htmlFor="lead-accident-details"
                wide
              >
                <Textarea
                  id="lead-accident-details"
                  value={draft.accidentDetails}
                  disabled={!canEdit}
                  className="min-h-16"
                  onChange={(event) =>
                    changeText("accidentDetails", event.target.value)
                  }
                  onBlur={() => flush("accidentDetails")}
                />
              </FormField>
            </div>
          </section>

          {canSeeAttribution ? (
            <Section title="Attribution" columns={4} className="lg:col-span-8">
              <Field label="IP address">{orDash(lead.ipaddress)}</Field>
              <Field label="TrustedForm">{orDash(lead.trustedform)}</Field>
              <Field label="Jornaya">{orDash(lead.jornaya)}</Field>
              <Field label="Source">{orDash(lead.source)}</Field>
              <Field label="Medium">{orDash(lead.medium)}</Field>
              <Field label="Content">{orDash(lead.content)}</Field>
            </Section>
          ) : null}

          <Section
            title="Firm submission"
            columns={canSeeAttribution ? 2 : 3}
            className={canSeeAttribution ? "lg:col-span-4" : "lg:col-span-12"}
          >
            <Field label="Sent to firm">
              {sentAt ? formatDateTime(sentAt) : "Not sent"}
            </Field>
            <Field label="Brightwater lead id">
              {orDash(brightwaterLeadId)}
            </Field>
            {sent ? null : (
              <div
                className={`col-span-2 grid gap-2 ${
                  canSeeAttribution ? "" : "lg:col-span-3"
                }`}
              >
                {lead.caseType !== "MVA" ? (
                  <p className="text-xs text-muted-foreground">
                    Only MVA leads are sent to the firm.
                  </p>
                ) : canSend ? (
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => void handleSend()}
                    disabled={sending}
                  >
                    {sending ? "Sending…" : "Send to Firm"}
                  </Button>
                ) : null}
              </div>
            )}
          </Section>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        <DialogFooter className="sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Changes save automatically.
          </p>
          <div className="flex items-center justify-end gap-3">
            <SaveState status={status} />
            <Button type="button" variant="outline" onClick={handleClose}>
              Close
            </Button>
          </div>
        </DialogFooter>
      </div>
    </>
  );
}
