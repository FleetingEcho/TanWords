import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useDB, DocumentListItem, DocumentFolder, DocStatus } from "@/hooks/useDB";

export const PAGE_SIZE = 10_000;

/** Keystroke-to-query debounce for the search box: each change used to fire
 *  an FTS5 query immediately, and out-of-order responses could rewrite the
 *  list with stale results. */
const SEARCH_DEBOUNCE_MS = 250;

/** The document list itself: search/sort/tag/date filters, pagination, and
 * the load that ties them together. Split out of DocSelector so the CRUD
 * and import/export hooks (useDocActions, useDocImportExport) can share one
 * `load`/`page` without owning the filter state themselves. */
export function useDocList(refreshKey: string | number) {
  const db = useDB();
  const [docs, setDocs] = useState<DocumentListItem[]>([]);
  // Folders that hold no documents — the tree the shelf draws is the union of
  // these and the distinct `doc.folder` values, so a folder emptied by a drag
  // does not vanish from under the cursor.
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  // What queries actually run against — search trails `search` by the
  // debounce, so typing bursts cost one query, not one per keystroke.
  const [effectiveSearch, setEffectiveSearch] = useState("");
  const [sort, setSort] = useState("modified");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const pageRef = useRef(page);
  pageRef.current = page;
  // Response ordering: a slow earlier query must not overwrite a newer one.
  // (The local-files shelf has the same guard via LocalDocsView's
  // searchSequence.)
  const querySeq = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setEffectiveSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // Note: depends on pageRef, not page — including `page` here would make
  // the filter effect (dep [load]) refire on mere page navigation.
  const load = useCallback(async (p = pageRef.current) => {
    setLoading(true);
    const mySeq = ++querySeq.current;
    try {
      const [result, folderPaths] = await Promise.all([
        db.getDocuments({
          search: effectiveSearch || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          tag: tagFilter || undefined,
          status: statusFilter || undefined,
          sort,
          page: p,
        }),
        db.listDocumentFolders(),
      ]);
      if (mySeq !== querySeq.current) return;
      setDocs(result.items);
      setFolders(folderPaths);
      setTotal(result.total);
    } finally {
      if (mySeq === querySeq.current) setLoading(false);
    }
  }, [effectiveSearch, sort, dateFrom, dateTo, tagFilter, statusFilter]);

  // New filters always start from page 0. If we're already there the load
  // happens here; otherwise the [page] effect's load covers the reset —
  // doing both fired the same query twice whenever a filter changed while
  // on a later page.
  useEffect(() => {
    if (pageRef.current === 0) void load(0);
    else setPage(0);
  }, [load, refreshKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- pagination reuses whatever filters/load are current.
  useEffect(() => { void load(page); }, [page]);

  // An outside agent can write documents through the MCP server while this
  // list is on screen (see hooks/useMcpSync) — reload rather than showing a
  // list that silently disagrees with the database.
  useEffect(() => {
    const onExternalChange = () => { void load(pageRef.current); };
    window.addEventListener("docs-updated", onExternalChange);
    return () => window.removeEventListener("docs-updated", onExternalChange);
  }, [load]);
  // Save updates the DB asynchronously, but reloading the whole list after
  // every keystroke caused noticeable UI churn. Patch the in-memory item in
  // place so counts/titles/tags stay current without a full refetch.
  useEffect(() => {
    const onItemUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ id: number; wordCount?: number; title?: string; tags?: string; pinned?: boolean; taskTotal?: number; taskDone?: number; status?: string }>).detail;
      if (!detail || typeof detail.id !== "number") return;
      setDocs((current) => current.map((doc) => (
        doc.id === detail.id
          ? {
              ...doc,
              word_count: detail.wordCount ?? doc.word_count,
              title: detail.title ?? doc.title,
              tags: detail.tags ?? doc.tags,
              pinned: detail.pinned ?? doc.pinned,
              task_total: detail.taskTotal ?? doc.task_total,
              task_done: detail.taskDone ?? doc.task_done,
              status: (detail.status ?? doc.status) as DocStatus,
            }
          : doc
      )));
    };
    window.addEventListener("docs-item-updated", onItemUpdated);
    return () => window.removeEventListener("docs-item-updated", onItemUpdated);
  }, []);
  useEffect(() => { db.getAllTags().then(setAllTags); }, [refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Whole library is in memory (PAGE_SIZE is 10k), so per-tag counts fall out
  // of the current `docs` with no extra query. Same tolerant parse DocItem uses.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const doc of docs) {
      let list: string[] = [];
      try { list = JSON.parse(doc.tags); } catch { /* malformed tags -> ignore */ }
      for (const tag of list) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return counts;
  }, [docs]);

  // Per-status counts for the filter, straight from the already-loaded rows.
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const doc of docs) counts.set(doc.status, (counts.get(doc.status) ?? 0) + 1);
    return counts;
  }, [docs]);

  return {
    db, docs, folders, total, page, setPage, search, setSearch, sort, setSort,
    dateFrom, setDateFrom, dateTo, setDateTo, allTags, tagFilter, setTagFilter,
    statusFilter, setStatusFilter, statusCounts,
    filtersOpen, setFiltersOpen, loading, load, totalPages, tagCounts,
  };
}

export type DocListState = ReturnType<typeof useDocList>;
