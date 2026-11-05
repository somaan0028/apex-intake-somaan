/**
 * RBAC matrix check.
 *
 * Asserts the role → capability grants *and* the resource-aware policies against
 * the table in the brief, so editing `ROLE_PERMISSIONS` or a policy without
 * meaning to is caught here rather than in the app.
 *
 * Usage: `npm run rbac:check`
 */
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  can,
  canAssignLead,
  canChangeLeadStage,
  canChangeUserRole,
  canDeleteUser,
  canEditLead,
  canManageUsers,
  canSendLeadToFirm,
  canViewLead,
  isLeadReadyToSend,
  type Actor,
  type LeadSubject,
  type Permission,
  type UserSubject,
} from "../lib/rbac/index";
import type { UserRole } from "../lib/db/schema";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}` +
      (ok ? "" : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`),
  );
}

// --- Fixtures --------------------------------------------------------------

const admin: Actor = { id: 1, role: "ADMIN" };
const agent: Actor = { id: 2, role: "USER" };

const unassigned: LeadSubject = {
  assignedToId: null,
  caseType: "MVA",
  sentToFirmAt: null,
  brightwaterLeadId: null,
};
const own: LeadSubject = {
  assignedToId: agent.id,
  caseType: "MVA",
  sentToFirmAt: null,
  brightwaterLeadId: null,
};
const others: LeadSubject = {
  assignedToId: 99,
  caseType: "MVA",
  sentToFirmAt: null,
  brightwaterLeadId: null,
};
const massTort: LeadSubject = {
  assignedToId: null,
  caseType: "MASS_TORT",
  sentToFirmAt: null,
  brightwaterLeadId: null,
};
const alreadySent: LeadSubject = {
  assignedToId: null,
  caseType: "MVA",
  sentToFirmAt: new Date(),
  brightwaterLeadId: null,
};
const alreadySentByLeadId: LeadSubject = {
  assignedToId: null,
  caseType: "MVA",
  sentToFirmAt: null,
  brightwaterLeadId: "123456",
};

// --- The grant matrix ------------------------------------------------------

console.log("Grants");
const expectedGrants: Record<UserRole, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  USER: [
    "leads.view.assigned",
    "leads.view.unassigned",
    "leads.edit.own",
    "leads.claim",
    "leads.release",
    "leads.resolve_duplicates",
  ],
};
for (const role of Object.keys(expectedGrants) as UserRole[]) {
  for (const permission of PERMISSIONS) {
    check(
      `${role} → ${permission}`,
      can(role, permission),
      expectedGrants[role].includes(permission),
    );
  }
}
// The map must cover every role exactly (no missing/extra entries).
check(
  "ROLE_PERMISSIONS covers every role",
  Object.keys(ROLE_PERMISSIONS).sort().join(","),
  (Object.keys(expectedGrants) as UserRole[]).sort().join(","),
);

// --- Visibility ------------------------------------------------------------

console.log("\nSees");
check("admin sees another agent's lead", canViewLead(admin, others), true);
check("agent sees an unassigned lead", canViewLead(agent, unassigned), true);
check("agent sees their own lead", canViewLead(agent, own), true);
check("agent cannot see another agent's lead", canViewLead(agent, others), false);

// --- Edit / move stages ----------------------------------------------------

console.log("\nEdit / move stages");
check("agent cannot edit an unassigned lead (must claim first)", canEditLead(agent, unassigned), false);
check("agent edits their own lead", canEditLead(agent, own), true);
check("agent cannot edit another agent's lead", canEditLead(agent, others), false);
check("admin edits any lead", canEditLead(admin, others), true);

check("agent moves own lead up to Retained", canChangeLeadStage(agent, own, "RETAINED"), true);
check("agent may disqualify their own lead", canChangeLeadStage(agent, own, "DISQUALIFIED"), true);
check("agent cannot send own lead to the firm", canChangeLeadStage(agent, own, "SENT_TO_FIRM"), false);
check("agent cannot move an unassigned lead", canChangeLeadStage(agent, unassigned, "CONTACTED"), false);
check("admin moves any lead to the firm stage", canChangeLeadStage(admin, others, "SENT_TO_FIRM"), true);

// --- Assign ----------------------------------------------------------------

console.log("\nAssign");
check("admin assigns any lead to anyone", canAssignLead(admin, others, 99), true);
check("admin unassigns any lead", canAssignLead(admin, others, null), true);
check("agent claims an unassigned lead", canAssignLead(agent, unassigned, agent.id), true);
check("agent cannot assign an unassigned lead to someone else", canAssignLead(agent, unassigned, 99), false);
check("agent cannot re-claim a lead already theirs", canAssignLead(agent, own, agent.id), false);
check("agent cannot claim another agent's lead", canAssignLead(agent, others, agent.id), false);
check("agent releases a lead they own", canAssignLead(agent, own, null), true);
check("agent cannot release a lead they don't own", canAssignLead(agent, others, null), false);
check("agent cannot 'release' an already-unassigned lead", canAssignLead(agent, unassigned, null), false);

// --- Send to firm ----------------------------------------------------------

console.log("\nSend to firm");
check("agent cannot send to the firm", canSendLeadToFirm(agent, own), false);
check("admin sends an unsent MVA lead", canSendLeadToFirm(admin, unassigned), true);
check("MASS_TORT leads never go to the firm", canSendLeadToFirm(admin, massTort), false);
check("an already-sent lead is not re-sent", canSendLeadToFirm(admin, alreadySent), false);
check(
  "a lead with a Brightwater id is not re-sent",
  canSendLeadToFirm(admin, alreadySentByLeadId),
  false,
);
check("a Retained lead is ready to send", isLeadReadyToSend({ stage: "RETAINED" }), true);
check("a New lead is not ready to send", isLeadReadyToSend({ stage: "NEW" }), false);
check(
  "a Qualified lead is not ready to send",
  isLeadReadyToSend({ stage: "QUALIFIED" }),
  false,
);
check("agent cannot see attribution", can("USER", "leads.view.attribution"), false);
check("admin can see attribution", can("ADMIN", "leads.view.attribution"), true);

// --- Manage users ----------------------------------------------------------

console.log("\nManage users");
check("admin manages users", canManageUsers(admin), true);
check("agent cannot manage users", canManageUsers(agent), false);

// --- Deleting / re-roling users --------------------------------------------

console.log("\nDelete / re-role users");
const self: UserSubject = { id: admin.id, role: "ADMIN" };
const otherAdmin: UserSubject = { id: 7, role: "ADMIN" };
const otherAgent: UserSubject = { id: 8, role: "USER" };

check("admin deletes an agent", canDeleteUser(admin, otherAgent, 2), true);
check("admin deletes another admin when others remain", canDeleteUser(admin, otherAdmin, 2), true);
check("admin cannot delete themselves", canDeleteUser(admin, self, 2), false);
check("the last admin cannot be deleted", canDeleteUser(admin, otherAdmin, 1), false);
check("agent cannot delete anyone", canDeleteUser(agent, otherAgent, 2), false);

check("admin demotes another admin when others remain", canChangeUserRole(admin, otherAdmin, "USER", 2), true);
check("the last admin cannot be demoted", canChangeUserRole(admin, otherAdmin, "USER", 1), false);
check("admin promotes an agent", canChangeUserRole(admin, otherAgent, "ADMIN", 2), true);
check("agent cannot change a role", canChangeUserRole(agent, otherAgent, "ADMIN", 2), false);

// --- Result ----------------------------------------------------------------

console.log(
  failures
    ? `\n${failures} RBAC check(s) failed.`
    : "\nAll RBAC checks passed.",
);
process.exit(failures ? 1 : 0);
