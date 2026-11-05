import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { toNullableDate } from "@/lib/db/normalize";
import { leads, type NewLead } from "@/lib/db/schema";
import { clientIpFromHeaders } from "@/lib/leads/client-ip";
import { buildDupMatchString } from "@/lib/leads/dup-matcher";
import { scheduleDupCheck } from "@/lib/leads/dup-queue";
import {
  INTAKE_FIELD_LABELS,
  validateIntakeSubmission,
} from "@/lib/leads/intake";

/**
 * Public endpoint — the intake form posts here, so it is deliberately
 * unauthenticated (allow-listed in `proxy.ts`). Everything it writes comes from
 * `validateIntakeSubmission`, which is the only trusted interpretation of the
 * request body.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const result = validateIntakeSubmission(body);
  if (!result.ok) {
    const details = Object.entries(result.errors).map(([key, message]) => {
      const label = INTAKE_FIELD_LABELS[key] ?? key;
      return `${label} — ${message}`;
    });
    console.error("[intake] rejected submission:", result.errors);
    return NextResponse.json(
      {
        error: `Please fix: ${details.join(" ")}`,
        errors: result.errors,
      },
      { status: 422 },
    );
  }

  const data = result.data;

  // Field names already mirror the columns, so the insert is near-direct.
  const lead: NewLead = {
    // Matter ids come from the Lawmatics export; a public submission has none.
    matterId: "",
    createdAt: new Date(),
    caseType: data.caseType,
    stage: "NEW",
    isFillingForSomeoneElse: data.isFillingForSomeoneElse,
    // Empty when filing for themselves — the injured person is the submitter.
    fillerFirstName: data.fillerFirstName,
    fillerLastName: data.fillerLastName,
    fillerPhone: data.fillerPhone,
    fillerEmail: data.fillerEmail,
    injuredFirstName: data.injuredFirstName,
    injuredLastName: data.injuredLastName,
    injuredPhone: data.injuredPhone,
    injuredEmail: data.injuredEmail,
    relationshipToInjured: data.relationshipToInjured,
    dateOfAccident: toNullableDate(data.dateOfAccident),
    state: data.state,
    county: data.county,
    postcode: data.postcode,
    injuryDetails: data.injuryDetails,
    accidentDetails: data.accidentDetails,
    isAtFault: data.isAtFault,
    hasAttorney: data.hasAttorney,
    hasReceivedSettlement: data.hasReceivedSettlement,
    source: data.source,
    medium: data.medium,
    content: data.content,
    // Transport fact, not user input: the form never sends this and the body
    // cannot set it. `x-forwarded-for` is populated from the connection.
    ipaddress: clientIpFromHeaders(request.headers),
    // Cheap to build, so it is stored with the row. The fuzzy comparison
    // against existing leads runs after the response has been sent.
    dupMatchString: buildDupMatchString(
      data.injuredFirstName,
      data.injuredLastName,
      data.injuredEmail,
      data.injuredPhone,
    ),
  };

  let insertedId: number;
  try {
    const inserted = getDb()
      .insert(leads)
      .values(lead)
      .returning({ id: leads.id })
      .get();
    insertedId = inserted.id;
  } catch (error) {
    console.error("[intake] Failed to save lead:", error);
    return NextResponse.json(
      { error: "We couldn't save your information. Please try again." },
      { status: 500 },
    );
  }

  // Fire-and-forget: the submitter never waits for, or learns about, the
  // duplicate check.
  scheduleDupCheck(insertedId);

  return NextResponse.json({ ok: true }, { status: 201 });
}
