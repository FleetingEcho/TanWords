import React, { useEffect, useState } from "react";
import { api, TableInfo } from "./api";

export function TableBrowser() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [active, setActive] = useState<string>("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ rowid: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const limit = 50;

  useEffect(() => {
    api.listTables().then((t) => {
      setTables(t);
      if (t.length > 0) setActive(t.find((x) => x.name === "words")?.name ?? t[0].name);
    });
  }, []);

  const load = () => {
    if (!active) return;
    api.tableRows(active, page, search).then((r) => {
      setRows(r.rows);
      setTotal(r.total);
    });
  };

  useEffect(() => {
    setPage(0);
  }, [active]);

  useEffect(() => {
    load();
  }, [active, page]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [search]);

  const columns = rows.length > 0 ? Object.keys(rows[0]).filter((k) => k !== "_rowid") : [];

  const startEdit = (rowid: number, col: string, value: unknown) => {
    setEditing({ rowid, col });
    setEditValue(String(value ?? ""));
  };

  const commitEdit = async () => {
    if (!editing) return;
    await api.updateRow(active, editing.rowid, { [editing.col]: editValue });
    setEditing(null);
    load();
  };

  const handleDelete = async (rowid: number) => {
    if (!confirm(`Delete row ${rowid} from ${active}?`)) return;
    await api.deleteRow(active, rowid);
    load();
  };

  return (
    <div className="flex h-full">
      <nav className="w-56 shrink-0 border-r border-slate-800 overflow-y-auto py-3">
        {tables.map((t) => (
          <button
            key={t.name}
            onClick={() => setActive(t.name)}
            className={`w-full flex items-center justify-between px-4 py-1.5 text-sm text-left transition-colors ${
              active === t.name ? "bg-primary/15 text-primary font-medium" : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
            }`}
          >
            <span className="truncate">{t.name}</span>
            <span className="text-[10px] font-mono text-slate-500">{t.count}</span>
          </button>
        ))}
      </nav>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-800 shrink-0">
          <h2 className="text-sm font-semibold">{active}</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search text columns…"
            className="flex-1 h-8 px-3 text-xs rounded-lg border border-slate-700 bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <span className="text-xs text-slate-500 font-mono">{total} rows</span>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-950 border-b border-slate-800">
              <tr>
                {columns.map((c) => (
                  <th key={c} className="px-3 py-2 text-left font-semibold text-slate-400 whitespace-nowrap">
                    {c}
                  </th>
                ))}
                <th className="px-3 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rowid = row._rowid as number;
                return (
                  <tr key={rowid} className="border-b border-slate-900 hover:bg-slate-900/50">
                    {columns.map((c) => {
                      const isEditing = editing?.rowid === rowid && editing?.col === c;
                      return (
                        <td
                          key={c}
                          className="px-3 py-1.5 max-w-xs truncate cursor-pointer"
                          onClick={() => !isEditing && startEdit(rowid, c, row[c])}
                          title={String(row[c] ?? "")}
                        >
                          {isEditing ? (
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitEdit();
                                if (e.key === "Escape") setEditing(null);
                              }}
                              className="w-full h-6 px-1.5 rounded border border-primary bg-slate-800 text-xs focus:outline-none"
                            />
                          ) : (
                            <span className="text-slate-300">{String(row[c] ?? "")}</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() => handleDelete(rowid)}
                        className="text-slate-600 hover:text-red-400 transition-colors"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 1} className="px-3 py-8 text-center text-slate-600">
                    No rows
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-800 shrink-0">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30 transition-colors"
          >
            ← Prev
          </button>
          <span className="text-xs text-slate-500 font-mono">
            {page * limit + 1}–{Math.min((page + 1) * limit, total)} / {total}
          </span>
          <button
            onClick={() => setPage((p) => (p + 1) * limit < total ? p + 1 : p)}
            disabled={(page + 1) * limit >= total}
            className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30 transition-colors"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
