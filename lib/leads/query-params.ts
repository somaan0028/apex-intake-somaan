/**
 * Normalisation of the leads page URL into the params the list queries use.
 *
 * The page and the CSV export must interpret a link the same way, so this lives
 * in one place. It only rewrites the two view-dependent defaults the grid relies
 * on: the board drops the stage filter (it groups by stage itself), and a custom
 * date range always carries a lower bound.
 */
import { defaultAddedFrom, type LeadsView } from "./constants";

/** The shape Next.js hands a page (or `Object.fromEntries(url.searchParams)`). */
export type LeadsSearchParams = Record<
  string,
  string | string[] | undefined
>;

export function normalizeLeadsQueryParams(
  params: LeadsSearchParams,
  view: LeadsView,
): LeadsSearchParams {
  const queryParams = { ...params };
  if (view === "kanban") {
    // The board groups by stage, so an inherited stage filter would silently
    // hide every other column.
    delete queryParams["filter.stage"];
  }
  // No date window by default: the Added filter starts cleared ("Any time").
  // A URL that already carries from/to dates is treated as a custom range, and
  // a custom range without a lower bound still gets the picker's default.
  if (!queryParams["filter.addedWithin"]) {
    const hasCustomDates =
      Boolean(queryParams["filter.addedFrom"]) ||
      Boolean(queryParams["filter.addedTo"]);
    if (hasCustomDates) queryParams["filter.addedWithin"] = "custom";
  }
  if (
    queryParams["filter.addedWithin"] === "custom" &&
    !queryParams["filter.addedFrom"]
  ) {
    queryParams["filter.addedFrom"] = defaultAddedFrom();
  }
  return queryParams;
}
