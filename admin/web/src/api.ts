const API = "http://127.0.0.1:5198/api";

export interface TableInfo {
  name: string;
  count: number;
}

export interface Column {
  name: string;
  type: string;
  pk: number;
}

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export const api = {
  health: () => request<{ ok: boolean; dbPath: string }>("/health"),
  listTables: () => request<TableInfo[]>("/tables"),
  tableSchema: (name: string) => request<Column[]>(`/tables/${name}/schema`),
  tableRows: (name: string, page: number, search: string) =>
    request<{ rows: Record<string, unknown>[]; total: number; page: number; limit: number }>(
      `/tables/${name}?page=${page}&search=${encodeURIComponent(search)}`
    ),
  updateRow: (name: string, rowid: number, patch: Record<string, unknown>) =>
    request(`/tables/${name}/${rowid}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteRow: (name: string, rowid: number) =>
    request(`/tables/${name}/${rowid}`, { method: "DELETE" }),

  generatePreview: (words: string[], config: { baseUrl: string; apiKey?: string; model: string }) =>
    request<{ items: any[]; skipped: number }>("/generate/preview", {
      method: "POST",
      body: JSON.stringify({ words, config }),
    }),
  generateCommit: (items: any[], source: string) =>
    request<{ added: number; skipped: number }>("/generate/commit", {
      method: "POST",
      body: JSON.stringify({ items, source }),
    }),
};
