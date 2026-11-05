/**
 * Kanban board windowing constants and URL helpers.
 *
 * A board is six independent backlogs, so it never uses the table's shared
 * pager. Each stage column loads its first `KANBAN_DEFAULT_LANE_SIZE` cards and
 * remembers how far it has been expanded in the URL as
 * `board.<STAGE>=<limit>`. The limits are deliberately not part of
 * `filters`: they are a transient view detail, not something a saved view or
 * the "active filters" badge should carry.
 */
import { LEAD_STAGES, type LeadStage } from "@/lib/db/schema";
import type { TableQuerySource } from "@/lib/table-query";

/** Cards loaded into each stage column on a fresh board. */
export const KANBAN_DEFAULT_LANE_SIZE = 10;

/** How many more cards one "Show more" click adds to a column. */
export const KANBAN_LANE_STEP = 10;

/**
 * Hard ceiling per column. Beyond this a board stops being a board: the column
 * says how many cards it is not showing and asks the viewer to narrow the
 * filters instead of painting thousands of cards.
 */
export const KANBAN_MAX_LANE_SIZE = 200;

const LANE_PARAM_PREFIX = "board.";

/** The URL param that carries one stage column's loaded-card limit. */
export function kanbanLaneParam(stage: LeadStage): string {
  return `${LANE_PARAM_PREFIX}${stage}`;
}

/** True for any board lane param, so a view switch can drop them all. */
export function isKanbanLaneParam(key: string): boolean {
  return key.startsWith(LANE_PARAM_PREFIX);
}

/**
 * Read the per-stage limits from the URL. Anything missing, malformed or
 * out of range falls back to the default or the ceiling, so a hand-edited
 * `board.NEW=999999` cannot make the server paint an unbounded column.
 */
export function parseKanbanLimits(
  source: TableQuerySource,
): Record<LeadStage, number> {
  const read = (key: string): string | undefined => {
    if (source instanceof URLSearchParams) return source.get(key) ?? undefined;
    const value = source[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const limits = {} as Record<LeadStage, number>;
  for (const stage of LEAD_STAGES) {
    const raw = Number(read(kanbanLaneParam(stage)));
    limits[stage] =
      Number.isInteger(raw) && raw > 0
        ? Math.min(raw, KANBAN_MAX_LANE_SIZE)
        : KANBAN_DEFAULT_LANE_SIZE;
  }
  return limits;
}
