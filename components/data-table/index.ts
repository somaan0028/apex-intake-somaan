/**
 * Barrel for the shared data-table module.
 *
 *     import { DataTable, useTableQuerySync } from "@/components/data-table";
 */
export {
  DataTable,
  type DataTableFilter,
  type DataTableFilterOption,
  type DataTableProps,
} from "./data-table";
export { dataTableFeatures, type DataTableFeatures } from "./features";
export { useTableQuerySync } from "./use-table-query-sync";
