import { useEffect, useState, useCallback } from "react";
import { useDB, DocumentListItem } from "@/hooks/useDB";

export const PAGE_SIZE = 10_000;

/** The document list itself: search/sort/tag/date filters, pagination, and
 * the load that ties them together. Split out of DocSelector so the CRUD
 * and import/export hooks (useDocActions, useDocImportExport) can share one
 * `load`/`page` without owning the filter state themselves. */
export function useDocList(refreshKey: number) {
  const db = useDB();
  const [docs, setDocs] = useState<DocumentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("modified");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const result = await db.getDocuments({
        search: search || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        tag: tagFilter || undefined,
        sort,
        page: p,
      });
      setDocs(result.items);
      setTotal(result.total);
    } finally {
      setLoading(false);
    }
  }, [search, sort, dateFrom, dateTo, tagFilter, page]);

  useEffect(() => { load(0); setPage(0); }, [search, sort, dateFrom, dateTo, tagFilter, refreshKey]);
  useEffect(() => { load(page); }, [page]);

  // An outside agent can write documents through the MCP server while this
  // list is on screen (see hooks/useMcpSync) — reload rather than showing a
  // list that silently disagrees with the database.
  useEffect(() => {
    const onExternalChange = () => { void load(page); };
    window.addEventListener("docs-updated", onExternalChange);
    return () => window.removeEventListener("docs-updated", onExternalChange);
  }, [load, page]);
  useEffect(() => { db.getAllTags().then(setAllTags); }, [refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return {
    db, docs, total, page, setPage, search, setSearch, sort, setSort,
    dateFrom, setDateFrom, dateTo, setDateTo, allTags, tagFilter, setTagFilter,
    filtersOpen, setFiltersOpen, loading, load, totalPages,
  };
}

export type DocListState = ReturnType<typeof useDocList>;
