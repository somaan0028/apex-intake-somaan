/**
 * Ad tracking parameters (`utm_*`) captured by the public intake form.
 *
 * The form reads them from the landing URL and posts them with the submission;
 * the endpoint is the only place that decides what they mean (see
 * `lib/leads/intake.ts`). Anything unrecognised is stored verbatim rather than
 * dropped, so a new ad platform needs no code change to start being counted.
 *
 * This module is client-safe (type-only schema import): the form needs the same
 * mapping the server applies, so the preselect and the stored value agree.
 */
import type { CaseType } from "@/lib/db/schema";

/** `utm_source` values the desk knows about, mapped to the stored source label. */
export const UTM_SOURCE_TO_LEAD_SOURCE: Readonly<Record<string, string>> = {
  facebook: "Facebook",
  google: "Google Ads",
  tiktok: "TikTok",
};

/** `utm_campaign` values that identify a case type. */
export const UTM_CAMPAIGN_TO_CASE_TYPE: Readonly<Record<string, CaseType>> = {
  mva: "MVA",
  mass_tort: "MASS_TORT",
};

/** The four tracking parameters, all optional. */
export interface UtmParams {
  source: string | null;
  campaign: string | null;
  medium: string | null;
  content: string | null;
}

export const EMPTY_UTM: UtmParams = {
  source: null,
  campaign: null,
  medium: null,
  content: null,
};

/** Keep tracking values useful but bounded (they arrive from a public URL). */
export const MAX_UTM_LENGTH = 255;

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, MAX_UTM_LENGTH);
}

/** Read `utm_*` from a URL's search params. Keys are case-insensitive in spirit. */
export function readUtmParams(search: Pick<URLSearchParams, "get">): UtmParams {
  return {
    source: clean(search.get("utm_source")),
    campaign: clean(search.get("utm_campaign")),
    medium: clean(search.get("utm_medium")),
    content: clean(search.get("utm_content")),
  };
}

/** The source to store for an ad: the mapped label, or the raw value if new. */
export function leadSourceFromUtm(source: string | null): string | null {
  if (!source) return null;
  return UTM_SOURCE_TO_LEAD_SOURCE[source.toLowerCase()] ?? source;
}

/** The case type an ad campaign identifies, or `null` if it is not one we know. */
export function caseTypeFromCampaign(campaign: string | null): CaseType | null {
  if (!campaign) return null;
  return UTM_CAMPAIGN_TO_CASE_TYPE[campaign.toLowerCase()] ?? null;
}
