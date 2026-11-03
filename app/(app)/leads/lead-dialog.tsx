"use client";

/**
 * Read-mostly detail dialog for a lead.
 *
 * Everything is shown as plain text except the two fields a viewer may change:
 * the **stage** and the **assignee**. Which of those is editable, and which
 * options they offer, comes from the same RBAC policies the Server Action
 * enforces — so the controls never offer something the server would reject:
 *
 *   - an admin may move any lead to any stage and assign it to anyone;
 *   - an agent may move a lead they own up to Retained, and may assign only
 *     themselves (claim an unassigned lead, or release one they own).
 */
import { useRouter } from "next/navigation";
import {
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LEAD_STAGES, type LeadStage } from "@/lib/db/schema";
import { formatDate } from "@/lib/format";
import {
  CASE_TYPE_LABELS,
  LEAD_STAGE_LABELS,
  assigneeLabel,
  relationshipLabel,
} from "@/lib/labels";
import { updateLead } from "@/lib/leads/actions";
import { UNASSIGNED } from "@/lib/leads/constants";
import type { LeadRow } from "@/lib/leads/queries";
import {
  canAssignLead,
  canChangeLeadStage,
  canEditLead,
  type Actor,
} from "@/lib/rbac";

const STAGE_OPTIONS = LEAD_STAGES.map((value) => ({
  label: LEAD_STAGE_LABELS[value],
  value,
}));

/** A value that may be missing, rendered as a dash. */
function orDash(value: string | null | undefined): ReactNode {
  return value ? value : <span className="text-muted-foreground">—</span>;
}

function fullName(first: string | null, last: string | null): ReactNode {
  return orDash([first, last].filter(Boolean).join(" "));
}

/** Tri-state answer; `null` means "not recorded". */
function triState(value: boolean | null): string {
  if (value === null) return "Unknown";
  return value ? "Yes" : "No";
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
    <div className={wide ? "col-span-2 grid gap-1" : "grid gap-1"}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

/** A titled group of read-only fields. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</dl>
    </section>
  );
}

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
      <DialogContent className="sm:max-w-2xl">
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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const currentAssignee =
    lead.assignedToId === null ? UNASSIGNED : String(lead.assignedToId);
  const [stage, setStage] = useState<LeadStage>(lead.stage);
  const [assignedTo, setAssignedTo] = useState(currentAssignee);

  const canEditStage = canEditLead(viewer, lead);

  // The options are exactly what this viewer may set: admins get the whole team,
  // an agent gets only themselves (the UI adds the unassigned choice).
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
    lead.assignedToId !== null &&
    !assignees.some((assignee) => assignee.id === lead.assignedToId)
  ) {
    assigneeOptions.push({
      label: lead.assignedToName ?? `User #${lead.assignedToId}`,
      value: String(lead.assignedToId),
    });
  }

  const dirty = stage !== lead.stage || assignedTo !== currentAssignee;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("id", String(lead.id));
    formData.set("stage", stage);
    formData.set("assignedToId", assignedTo);
    setError(null);

    startTransition(async () => {
      const result = await updateLead(formData);
      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Lead {lead.matterId}</DialogTitle>
        <DialogDescription>
          {lead.caseType ? CASE_TYPE_LABELS[lead.caseType] : "Unknown case type"}
          {" · added "}
          {formatDate(lead.createdAt)}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid max-h-[60vh] gap-5 overflow-y-auto pr-1">
          {/* The only editable fields. */}
          <section className="grid gap-3">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Case
            </h3>
            {/* `items-start` keeps the two columns at their natural height: without
                it the grid stretches the shorter column (Assigned to) to match
                the one carrying the helper note, and the extra space pushes its
                select out of line. */}
            <div className="grid grid-cols-2 items-start gap-4">
              <div className="grid gap-2">
                <Label htmlFor="lead-stage">Stage</Label>
                <Select
                  items={STAGE_OPTIONS}
                  value={stage}
                  onValueChange={(value) => {
                    if (value) setStage(value);
                  }}
                  disabled={!canEditStage}
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
                          option.value !== lead.stage &&
                          !canChangeLeadStage(viewer, lead, option.value)
                        }
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!canEditStage ? (
                  <p className="text-xs text-muted-foreground">
                    Only the agent who owns this lead can change its stage.
                  </p>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="lead-assignee">Assigned to</Label>
                <Select
                  items={assigneeOptions}
                  value={assignedTo}
                  onValueChange={(value) => {
                    if (value) setAssignedTo(value);
                  }}
                >
                  <SelectTrigger id="lead-assignee" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {assigneeOptions.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        disabled={
                          option.value !== currentAssignee &&
                          !canAssignLead(
                            viewer,
                            lead,
                            option.value === UNASSIGNED
                              ? null
                              : Number(option.value),
                          )
                        }
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <Section title="Injured person">
            <Field label="Name">
              {fullName(lead.injuredFirstName, lead.injuredLastName)}
            </Field>
            <Field label="Phone">{orDash(lead.injuredPhone)}</Field>
            <Field label="Email">{orDash(lead.injuredEmail)}</Field>
            <Field label="Date of accident">
              {formatDate(lead.dateOfAccident)}
            </Field>
          </Section>

          <Section title="Submitted by">
            <Field label="Submitted">
              {lead.isFillingForSomeoneElse
                ? "Someone else"
                : "Self (the injured person)"}
            </Field>
            {lead.isFillingForSomeoneElse ? (
              <>
                <Field label="Relationship">
                  {orDash(relationshipLabel(lead.relationshipToInjured))}
                </Field>
                <Field label="Contact name">
                  {fullName(lead.fillerFirstName, lead.fillerLastName)}
                </Field>
                <Field label="Contact phone">{orDash(lead.fillerPhone)}</Field>
                <Field label="Contact email">{orDash(lead.fillerEmail)}</Field>
              </>
            ) : null}
          </Section>

          <Section title="Location &amp; source">
            <Field label="State">{orDash(lead.state)}</Field>
            <Field label="County">{orDash(lead.county)}</Field>
            <Field label="Postcode">{orDash(lead.postcode)}</Field>
            <Field label="Source">{orDash(lead.source)}</Field>
          </Section>

          <Section title="Case facts">
            <Field label="At fault">{triState(lead.isAtFault)}</Field>
            <Field label="Has attorney">{triState(lead.hasAttorney)}</Field>
            <Field label="Received settlement">
              {triState(lead.hasReceivedSettlement)}
            </Field>
            <Field label="Matter id">{orDash(lead.matterId)}</Field>
            <Field label="Injury details" wide>
              {orDash(lead.injuryDetails)}
            </Field>
            <Field label="Accident details" wide>
              {orDash(lead.accidentDetails)}
            </Field>
          </Section>

          <Section title="Attribution">
            <Field label="IP address">{orDash(lead.ipaddress)}</Field>
            <Field label="TrustedForm">{orDash(lead.trustedform)}</Field>
            <Field label="Jornaya">{orDash(lead.jornaya)}</Field>
          </Section>

          <Section title="Firm submission">
            <Field label="Sent to firm">
              {lead.sentToFirmAt ? formatDate(lead.sentToFirmAt) : "Not sent"}
            </Field>
            <Field label="Brightwater lead id">
              {orDash(lead.brightwaterLeadId)}
            </Field>
          </Section>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={pending}
          >
            Close
          </Button>
          <Button type="submit" disabled={pending || !dirty}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
