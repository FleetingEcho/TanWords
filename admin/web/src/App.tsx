import React, { useEffect, useState } from "react";
import { TableBrowser } from "./TableBrowser";
import { BatchGenerate } from "./BatchGenerate";
import { api } from "./api";

type Tab = "tables" | "generate";

export default function App() {
  const [tab, setTab] = useState<Tab>("tables");
  const [dbPath, setDbPath] = useState("");
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .health()
      .then((h) => {
        setDbPath(h.dbPath);
        setConnected(true);
      })
      .catch(() => setConnected(false));
  }, []);

  if (connected === false) {
    return (
      <div className="h-screen flex items-center justify-center text-center px-6">
        <div>
          <p className="text-lg font-semibold text-red-400">无法连接到 API 服务</p>
          <p className="text-sm text-slate-500 mt-2">请确认 `npm run server` 正在运行</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center gap-4 px-5 h-12 border-b border-slate-800 shrink-0">
        <h1 className="text-sm font-bold">TanWords Admin</h1>
        <nav className="flex items-center gap-1">
          {(["tables", "generate"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                tab === t ? "bg-primary/15 text-primary" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {t === "tables" ? "表浏览器" : "批量生成"}
            </button>
          ))}
        </nav>
        <span className="ml-auto text-[10px] font-mono text-slate-600 truncate max-w-md" title={dbPath}>
          {dbPath}
        </span>
      </header>

      <main className="flex-1 min-h-0">
        {tab === "tables" ? <TableBrowser /> : <BatchGenerate />}
      </main>
    </div>
  );
}
