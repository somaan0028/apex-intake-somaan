/**
 * The leads page view preference (table vs Kanban).
 *
 * The view is a personal preference, not a filter: navigating to the leads page
 * from the dashboard or a stat card must not reset it. A small cookie lets the
 * server render the preferred view immediately; an explicit `view=table` or
 * `view=kanban` in the URL still wins for that page (a shared link or a saved
 * view). Filters and search remain ordinary URL state.
 */
import type { LeadsView } from "./constants";

/** Cookie name. Kept separate from the auth and saved-view storage. */
export const LEADS_VIEW_COOKIE = "apex_leads_view";

/** One year, in seconds. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Type guard for an untrusted cookie or URL value. */
export function isLeadsView(value: string | null | undefined): value is LeadsView {
  return value === "table" || value === "kanban";
}

/** The `document.cookie` string that records the preference. */
export function viewPreferenceCookie(view: LeadsView): string {
  return `${LEADS_VIEW_COOKIE}=${view}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax`;
}
