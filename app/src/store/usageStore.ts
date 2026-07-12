const STORAGE_KEY = "tanwords_ai_usage";

export interface UsageEntry {
  providerId: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

function load(): UsageEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function save(entries: UsageEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function logUsage(providerId: string, model: string, inputChars: number, outputChars: number): void {
  const entries = load();
  const idx = entries.findIndex((e) => e.providerId === providerId && e.model === model);
  const inputTokens = Math.round(inputChars / 4);
  const outputTokens = Math.round(outputChars / 4);
  if (idx >= 0) {
    entries[idx].calls += 1;
    entries[idx].inputTokens += inputTokens;
    entries[idx].outputTokens += outputTokens;
  } else {
    entries.push({ providerId, model, calls: 1, inputTokens, outputTokens });
  }
  save(entries);
}

export function getUsage(): UsageEntry[] {
  return load();
}

export function clearUsage(): void {
  save([]);
  window.dispatchEvent(new CustomEvent("usage-updated"));
}

export function getTotalTokens(): { input: number; output: number; total: number } {
  const entries = load();
  const input = entries.reduce((s, e) => s + e.inputTokens, 0);
  const output = entries.reduce((s, e) => s + e.outputTokens, 0);
  return { input, output, total: input + output };
}
