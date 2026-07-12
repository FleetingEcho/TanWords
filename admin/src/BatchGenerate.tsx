import React, { useState } from "react";
import { api } from "./api";

interface Row {
  word: string;
  zh: string;
  word_type: string;
  level: string;
  example_en?: string;
  example_zh?: string;
  mnemonic?: string;
  selected: boolean;
}

const CONFIG_KEY = "tanwords-admin.model-config";

function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || "");
  } catch {
    return { baseUrl: "http://localhost:11434/v1", apiKey: "", model: "llama3.1" };
  }
}

export function BatchGenerate() {
  const [config, setConfig] = useState(loadConfig());
  const [wordsInput, setWordsInput] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [committing, setCommitting] = useState(false);
  const [resultMsg, setResultMsg] = useState("");

  const saveConfig = (next: typeof config) => {
    setConfig(next);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  };

  const runGenerate = async () => {
    const words = wordsInput
      .split(/[\n,]/)
      .map((w) => w.trim())
      .filter(Boolean);
    if (words.length === 0) return;
    setLoading(true);
    setResultMsg("");
    try {
      const { items, skipped } = await api.generatePreview(words, config);
      setRows(items.map((it) => ({ ...it, selected: true })));
      setSkipped(skipped);
    } catch (e: any) {
      setResultMsg(`❌ ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const commit = async () => {
    const accepted = rows.filter((r) => r.selected);
    if (accepted.length === 0) return;
    setCommitting(true);
    try {
      const result = await api.generateCommit(accepted, "batch");
      setResultMsg(`✓ Added ${result.added}, skipped ${result.skipped} already present`);
      setRows([]);
      setWordsInput("");
    } catch (e: any) {
      setResultMsg(`❌ ${e.message}`);
    } finally {
      setCommitting(false);
    }
  };

  const updateRow = (i: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const selectedCount = rows.filter((r) => r.selected).length;

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto space-y-6">
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold">模型配置（OpenAI 兼容接口）</h2>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Base URL</label>
            <input
              value={config.baseUrl}
              onChange={(e) => saveConfig({ ...config, baseUrl: e.target.value })}
              placeholder="http://localhost:11434/v1"
              className="w-full h-8 px-2 text-xs rounded-lg border border-slate-700 bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Model</label>
            <input
              value={config.model}
              onChange={(e) => saveConfig({ ...config, model: e.target.value })}
              placeholder="llama3.1"
              className="w-full h-8 px-2 text-xs rounded-lg border border-slate-700 bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">API Key（可选）</label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => saveConfig({ ...config, apiKey: e.target.value })}
              className="w-full h-8 px-2 text-xs rounded-lg border border-slate-700 bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>
        <p className="text-[11px] text-slate-500">Ollama / LM Studio 开箱即用；云端 OpenAI 兼容接口也可。</p>
      </section>

      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold">词表输入</h2>
        <textarea
          value={wordsInput}
          onChange={(e) => setWordsInput(e.target.value)}
          placeholder={"每行一个词，或逗号分隔\npragmatic\nresilient\nmitigate"}
          rows={6}
          className="w-full p-3 text-sm rounded-lg border border-slate-700 bg-slate-800 leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          onClick={runGenerate}
          disabled={loading || !wordsInput.trim()}
          className="h-9 px-5 rounded-lg text-sm font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {loading ? "生成中…" : "✦ 生成"}
        </button>
        {resultMsg && <p className="text-xs">{resultMsg}</p>}
      </section>

      {rows.length > 0 && (
        <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
            <h2 className="text-sm font-semibold">
              预览结果（{rows.length} 词{skipped > 0 ? `，已跳过 ${skipped} 个已存在` : ""}）
            </h2>
            <button
              onClick={commit}
              disabled={committing || selectedCount === 0}
              className="h-8 px-4 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {committing ? "写入中…" : `确认写入 (${selectedCount})`}
            </button>
          </div>
          <div className="divide-y divide-slate-800 max-h-[60vh] overflow-y-auto">
            {rows.map((r, i) => (
              <div key={i} className="flex items-start gap-3 px-5 py-3">
                <input
                  type="checkbox"
                  checked={r.selected}
                  onChange={(e) => updateRow(i, { selected: e.target.checked })}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{r.word}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{r.word_type}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300">{r.level}</span>
                  </div>
                  <input
                    value={r.zh}
                    onChange={(e) => updateRow(i, { zh: e.target.value })}
                    className="w-full text-xs bg-transparent border-b border-transparent hover:border-slate-700 focus:border-primary focus:outline-none py-0.5"
                  />
                  {r.example_en && (
                    <p className="text-[11px] text-slate-500 italic">{r.example_en}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
