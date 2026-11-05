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
import {
  Check,
  Loader2,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  CASE_TYPES,
  LEAD_STAGES,
  RELATIONSHIPS,
  type LeadStage,
} from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";
import {
  CASE_TYPE_LABELS,
  LEAD_STAGE_LABELS,
  RELATIONSHIP_LABELS,
  assigneeLabel,
  caseTypeLabel,
} from "@/lib/labels";
import {
  checkLeadForDuplicates,
  deleteLead,
  markLeadNotDuplicate,
  sendLeadToFirm,
} from "@/lib/leads/actions";
import { UNASSIGNED } from "@/lib/leads/constants";
import type { LeadFieldPatch } from "@/lib/leads/editable";
import type { LeadRow } from "@/lib/leads/queries";
import {
  SEND_READY_STAGE,
  can,
  canAssignLead,
  canChangeLeadStage,
  canDeleteLead,
  canEditLead,
  canSendLeadToFirm,
  type Actor,
} from "@/lib/rbac";
import { COUNTIES_BY_STATE } from "@/lib/us-counties";
import { US_STATES } from "@/lib/us-states";
import {
  isValidEmail,
  isValidPhone,
  normalizePostcode,
} from "@/lib/validation";
import { LeadHistoryDialog } from "./lead-history-dialog";
import { useLeadAutoSave, type SaveStatus } from "./use-lead-autosave";

const STAGE_OPTIONS = LEAD_STAGES.map((value) => ({
  label: LEAD_STAGE_LABELS[value],
  value,
}));

/** Sentinel for "not set" in the state/county selects. */
const NONE = "__none__";

/** Matches the service's free-text guard. */
const MAX_TEXT_LENGTH = 5000;

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

/** A titled group of read-only fields, with an optional header action. */
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        {action}
      </div>
      <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3">{children}</dl>
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
  caseType: string;
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
  notes: string;
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
  | "accidentDetails"
  | "notes";

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
  const [sending, startSending] = useTransition();
  const [deleting, startDeleting] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [dupGroupId, setDupGroupId] = useState<string | null>(lead.dupGroupId);
  const [dupCount, setDupCount] = useState(lead.dupGroupCount);
  const [dupVisibleCount, setDupVisibleCount] = useState(
    lead.dupGroupVisibleCount,
  );
  const [dismissingDup, startDismissingDup] = useTransition();
  const [checkingDuplicates, startCheckingDuplicates] = useTransition();
  const {
    status,
    error,
    saveNow,
    schedule,
    flush,
    cancel,
    flushAll,
    flushAllNow,
  } = useLeadAutoSave(lead.id);

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
    caseType: lead.caseType ?? "",
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
    notes: lead.notes ?? "",
    isAtFault: lead.isAtFault,
    hasAttorney: lead.hasAttorney,
    hasReceivedSettlement: lead.hasReceivedSettlement,
  }));

  // The policy subject tracks local edits, so claiming a lead enables editing
  // without waiting for the grid refresh.
  const subject = {
    ...lead,
    caseType: draft.caseType || null,
    stage,
    assignedToId,
    sentToFirmAt: sentAt,
    brightwaterLeadId,
  };

  const canEdit = canEditLead(viewer, subject);
  const canDelete = canDeleteLead(viewer);
  const canSeeAttribution = can(viewer.role, "leads.view.attribution");
  const canAssignAny = can(viewer.role, "leads.assign.any");
  const canClaim = canAssignLead(viewer, subject, viewer.id);
  const canRelease = canAssignLead(viewer, subject, null);
  const sent = sentAt !== null || brightwaterLeadId !== null;
  const canSend = canSendLeadToFirm(viewer, subject);

  const today = new Date().toISOString().slice(0, 10);

  // Case type is normally a canonical code, but an imported lead may carry a
  // raw campaign value. Keep that value selectable so opening the dialog cannot
  // silently change it; every other option is a canonical code.
  const isKnownCaseType =
    lead.caseType !== null &&
    (CASE_TYPES as readonly string[]).includes(lead.caseType);
  const caseTypeOptions = [
    ...CASE_TYPES.map((value) => ({
      label: CASE_TYPE_LABELS[value],
      value,
    })),
    ...(lead.caseType && !isKnownCaseType
      ? [
          {
            label: `${caseTypeLabel(lead.caseType)} (campaign)`,
            value: lead.caseType,
          },
        ]
      : []),
  ];

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

  /** The same rules the service enforces, so invalid values never leave the browser. */
  function textFieldError(key: TextField, value: string): string | null {
    switch (key) {
      case "injuredFirstName":
        return value.trim() === "" ? "First name is required." : null;
      case "injuredLastName":
        return value.trim() === "" ? "Last name is required." : null;
      case "injuredEmail":
        return !isValidEmail(value) ? "Enter a valid email address." : null;
      case "injuredPhone":
        return !isValidPhone(value)
          ? "Enter a 10-digit US phone number."
          : null;
      case "postcode":
        return value.trim() !== "" && normalizePostcode(value) === null
          ? "Enter a valid ZIP code (12345 or 12345-6789)."
          : null;
      default:
        return null;
    }
  }

  const fieldErrors = {
    injuredFirstName: textFieldError(
      "injuredFirstName",
      draft.injuredFirstName,
    ),
    injuredLastName: textFieldError("injuredLastName", draft.injuredLastName),
    injuredEmail: textFieldError("injuredEmail", draft.injuredEmail),
    injuredPhone: textFieldError("injuredPhone", draft.injuredPhone),
    postcode: textFieldError("postcode", draft.postcode),
  } satisfies Partial<Record<TextField, string | null>>;

  /** Update a text field and debounce its save. */
  function changeText(key: TextField, value: string) {
    updateDraft(key, value);
    // Never send a value the server will reject; the inline message explains
    // why, and the next valid edit saves normally.
    if (textFieldError(key, value)) {
      cancel(key);
      return;
    }
    schedule(key, { [key]: value } as LeadFieldPatch);
  }

  async function changeCaseType(value: string) {
    const previous = draft.caseType;
    updateDraft("caseType", value);
    const ok = await saveNow({ caseType: value });
    if (!ok) updateDraft("caseType", previous);
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
        // The server's refusal is already a complete sentence (e.g. the
        // potential-duplicate and already-submitted messages), so show it as
        // the toast rather than burying it under a generic title.
        toast.error(result.error ?? "Could not send the lead to the firm.");
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

  /** Drill into the duplicate group, dropping every other filter. */
  function viewSimilar() {
    if (!dupGroupId) return;

    // The grid is visibility-scoped, so an agent may be looking at only part of
    // the cluster. Say so rather than silently showing a shorter list.
    if (dupCount > dupVisibleCount) {
      toast.warning(
        "You don't have access to some of the potentially similar leads. Please contact an Admin.",
      );
    }

    const params = new URLSearchParams({
      view: "table",
      "filter.dupGroup": dupGroupId,
    });
    onClose();
    router.push(`/leads?${params.toString()}`);
  }

  /** Clear this lead's grouping. The server refuses anyone but an admin. */
  function markNotDuplicate() {
    startDismissingDup(async () => {
      const result = await markLeadNotDuplicate(lead.id);
      if (!result.ok) {
        toast.error("Could not update duplicate status", {
          description: result.error ?? "Please try again.",
        });
        return;
      }

      setDupGroupId(null);
      setDupCount(0);
      setDupVisibleCount(0);
      toast.success("Marked as not a duplicate");
      router.refresh();
    });
  }

  /** Re-run the matcher, e.g. after an accidental "Not duplicate". */
  function checkForDuplicates() {
    startCheckingDuplicates(async () => {
      // Make sure a just-typed email/phone has reached the database first.
      await flushAllNow();

      const result = await checkLeadForDuplicates(lead.id);
      if (!result.ok) {
        toast.error("Could not check for duplicates", {
          description: result.error ?? "Please try again.",
        });
        return;
      }

      setDupGroupId(result.dupGroupId ?? null);
      setDupCount(result.dupGroupCount ?? 0);
      setDupVisibleCount(result.dupGroupVisibleCount ?? 0);

      if (result.dupGroupId) {
        toast.success("Potential duplicates found", {
          description: "This lead is now linked to similar leads.",
        });
      } else {
        toast.success("No potential duplicates found");
      }

      router.refresh();
    });
  }

  /** Delete after the confirmation, then close the now-stale dialog. */
  function handleDelete() {
    const formData = new FormData();
    formData.set("id", String(lead.id));

    startDeleting(async () => {
      const result = await deleteLead(formData);
      setConfirmingDelete(false);
      if (!result.ok) {
        toast.error("Could not delete the lead", {
          description: result.error ?? "Please try again.",
        });
        return;
      }
      toast.success("Lead deleted");
      onClose();
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
        {dupGroupId ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-900/60 dark:bg-amber-950/30">
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden
            />
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <p className="text-sm font-medium">Potential duplicate</p>
                <p className="text-xs text-muted-foreground">
                  This lead may be the same person as{" "}
                  {Math.max(dupCount - 1, 1)} other lead
                  {dupCount - 1 === 1 ? "" : "s"}.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={viewSimilar}
                >
                  View similar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={markNotDuplicate}
                  disabled={dismissingDup}
                >
                  {dismissingDup ? "Updating…" : "Mark as Not Duplicate"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid max-h-[60vh] gap-5 overflow-y-auto pr-1">
          {/* Stage + assignment. */}
          <section className="grid gap-3">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Case
            </h3>
            <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
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
                <LeadHistoryDialog
                  leadId={lead.id}
                  type="lead:stage_update"
                  triggerLabel="View past changes"
                  title="Past stage changes"
                  emptyMessage="No stage changes have been recorded yet."
                />
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
            <section className="grid gap-3">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Submitted by someone else
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

          <section className="grid gap-3">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Injured person
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="First name" htmlFor="injuredFirstName">
                <Input
                  id="injuredFirstName"
                  value={draft.injuredFirstName}
                  disabled={!canEdit}
                  aria-invalid={fieldErrors.injuredFirstName !== null}
                  onChange={(event) =>
                    changeText("injuredFirstName", event.target.value)
                  }
                  onBlur={() => flush("injuredFirstName")}
                />
                {fieldErrors.injuredFirstName ? (
                  <p className="text-xs text-destructive">
                    {fieldErrors.injuredFirstName}
                  </p>
                ) : null}
              </FormField>
              <FormField label="Last name" htmlFor="injuredLastName">
                <Input
                  id="injuredLastName"
                  value={draft.injuredLastName}
                  disabled={!canEdit}
                  aria-invalid={fieldErrors.injuredLastName !== null}
                  onChange={(event) =>
                    changeText("injuredLastName", event.target.value)
                  }
                  onBlur={() => flush("injuredLastName")}
                />
                {fieldErrors.injuredLastName ? (
                  <p className="text-xs text-destructive">
                    {fieldErrors.injuredLastName}
                  </p>
                ) : null}
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
                    aria-invalid={fieldErrors.injuredPhone !== null}
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
                {fieldErrors.injuredPhone ? (
                  <p className="text-xs text-destructive">
                    {fieldErrors.injuredPhone}
                  </p>
                ) : null}
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
                    aria-invalid={fieldErrors.injuredEmail !== null}
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
                {fieldErrors.injuredEmail ? (
                  <p className="text-xs text-destructive">
                    {fieldErrors.injuredEmail}
                  </p>
                ) : null}
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

          <section className="grid gap-3">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Location
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                  aria-invalid={fieldErrors.postcode !== null}
                  onChange={(event) =>
                    changeText("postcode", event.target.value)
                  }
                  onBlur={() => flush("postcode")}
                />
                {fieldErrors.postcode ? (
                  <p className="text-xs text-destructive">
                    {fieldErrors.postcode}
                  </p>
                ) : null}
              </FormField>
            </div>
          </section>

          <section className="grid gap-3">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Case facts
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Case type" htmlFor="lead-case-type">
                <Select
                  items={caseTypeOptions}
                  value={draft.caseType || null}
                  onValueChange={(value) => {
                    if (value) void changeCaseType(value);
                  }}
                  disabled={!canEdit}
                >
                  <SelectTrigger id="lead-case-type" className="w-full">
                    <SelectValue placeholder="Select a case type" />
                  </SelectTrigger>
                  <SelectContent>
                    {caseTypeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
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
                  maxLength={MAX_TEXT_LENGTH}
                  className="min-h-20"
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
                  maxLength={MAX_TEXT_LENGTH}
                  className="min-h-20"
                  onChange={(event) =>
                    changeText("accidentDetails", event.target.value)
                  }
                  onBlur={() => flush("accidentDetails")}
                />
              </FormField>
            </div>
          </section>

          <section className="grid gap-3">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Notes
            </h3>
            <Textarea
              id="lead-notes"
              aria-label="Notes"
              value={draft.notes}
              disabled={!canEdit}
              maxLength={MAX_TEXT_LENGTH}
              className="min-h-24"
              placeholder="Add a note about this lead…"
              onChange={(event) => changeText("notes", event.target.value)}
              onBlur={() => flush("notes")}
            />
            <p className="text-xs text-muted-foreground">
              Internal notes for your team. These are never sent to the firm.
            </p>
          </section>

          {canSeeAttribution ? (
            <Section title="Attribution">
              <Field label="IP address">{orDash(lead.ipaddress)}</Field>
              <Field label="TrustedForm">{orDash(lead.trustedform)}</Field>
              <Field label="Journaya">{orDash(lead.journaya)}</Field>
              <Field label="Source">{orDash(lead.source)}</Field>
              <Field label="Medium">{orDash(lead.medium)}</Field>
              <Field label="Content">{orDash(lead.content)}</Field>
            </Section>
          ) : null}

          {(draft.caseType || null) === "MVA" ? (
            <Section
              title="Firm submission"
              action={
                <LeadHistoryDialog
                  leadId={lead.id}
                  type="lead:send_to_firm"
                  triggerLabel="View attempts"
                  title="Submission attempts"
                  emptyMessage="No submission attempts have been recorded yet."
                />
              }
            >
              <Field label="Sent to firm">
                {sentAt ? formatDateTime(sentAt) : "Not sent"}
              </Field>
              <Field label="Brightwater lead id">
                {orDash(brightwaterLeadId)}
              </Field>
              {sent || !canSend ? null : (
                <div className="col-span-2 grid gap-2">
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => void handleSend()}
                    disabled={sending}
                  >
                    {sending ? "Sending…" : "Send to Firm"}
                  </Button>
                </div>
              )}
            </Section>
          ) : null}
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
          <div className="flex flex-wrap items-center gap-3">
            {canDelete ? (
              <Button
                type="button"
                variant="destructive"
                disabled={deleting}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 />
                Delete
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={checkForDuplicates}
              disabled={checkingDuplicates}
            >
              <RefreshCw
                className={checkingDuplicates ? "animate-spin" : undefined}
                aria-hidden
              />
              {checkingDuplicates ? "Checking…" : "Check for Duplicates"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 sm:ml-auto">
            <p className="text-xs text-muted-foreground">
              Changes save automatically.
            </p>
            <SaveState status={status} />
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={deleting}
            >
              Close
            </Button>
          </div>
        </DialogFooter>
      </div>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent forceBackdrop>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the lead and their details. This
              can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete lead"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
