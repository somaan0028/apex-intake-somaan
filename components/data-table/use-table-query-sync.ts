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
      const params = tableQueryToParams(next).toString();
      startTransition(() => {
        router.replace(params ? `${pathname}?${params}` : pathname, {
          scroll: false,
        });
      });
    },
    [pathname, router],
  );

  return { isPending, onQueryChange };
}
