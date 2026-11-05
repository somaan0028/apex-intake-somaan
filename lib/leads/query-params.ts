/**
 * Normalisation of the leads page URL into the params the list queries use.
 *
 * The page and the CSV export must interpret a link the same way, so this lives
 * in one place. Table and Kanban honour the same filters; the board only hides
 * the stage control in its toolbar. The one rewrite left is the date window: a
 * custom range always carries a lower bound.
 */
import { defaultAddedFrom } from "./constants";

/** The shape Next.js hands a page (or `Object.fromEntries(url.searchParams)`). */
export type LeadsSearchParams = Record<
  string,
  string | string[] | undefined
>;

export function normalizeLeadsQueryParams(
  params: LeadsSearchParams,
): LeadsSearchParams {
  const queryParams = { ...params };
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
