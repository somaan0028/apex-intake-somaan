"use client";

/**
 * Keeps a server-driven grid in sync with the URL.
 *
 * Every table page owns the same URL contract: it renders the query the server
 * used, and writes any change back to the URL, which re-renders the page and
 * refetches. This hook is that contract in one place.
 *
 * Returns the handler the grid calls with its next query, plus the pending flag
 * for the in-flight server render.
 */
import { useCallback, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { tableQueryToParams, type TableQuery } from "@/lib/table-query";

export function useTableQuerySync(): {
  isPending: boolean;
  onQueryChange: (next: TableQuery) => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const onQueryChange = useCallback(
    (next: TableQuery) => {
      const params = tableQueryToParams(next);

      // Keep params the table does not own, such as the leads page's `view`
      // switch, when a filter or the search changes.
      const current = new URLSearchParams(window.location.search);
      current.forEach((value, key) => {
        const owned =
          key === "page" ||
          key === "pageSize" ||
          key === "sort" ||
          key === "sortDir" ||
          key === "search" ||
          key.startsWith("filter.");
        if (!owned) params.set(key, value);
      });

      const query = params.toString();
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, {
          scroll: false,
        });
      });
    },
    [pathname, router],
  );

  return { isPending, onQueryChange };
}
