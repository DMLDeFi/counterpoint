// Server-only client for the RYO-CHAN Builder MCP REST surface.
// Never import this from a client component — the credential must stay server-side.
import "server-only";

const BASE = (process.env.RYO_MCP_URL ?? "").replace(/\/$/, "");
const KEY = process.env.RYO_MCP_CREDENTIAL ?? "";

if (!BASE || !KEY) {
  // Fails loudly at import time in any server context that forgot to set env vars,
  // instead of silently returning empty data later.
  console.warn("RYO_MCP_URL or RYO_MCP_CREDENTIAL is not set — RYO calls will fail.");
}

export type RyoStatus = "ok" | "partial" | "unavailable";
export type RyoDataMode = "live" | "mixed" | "simulated" | "unknown";

export interface RyoEnvelope<TData = unknown> {
  schema_version: string;
  tool: string;
  status: RyoStatus;
  data_mode: RyoDataMode;
  as_of: string;
  request: Record<string, unknown>;
  data: TData;
  summary: { headline: string; key_points: string[] };
  availability: Record<string, string>;
  warnings: string[];
}

export interface AnalyzeTokenData {
  asset: { symbol: string; name: string; chain: string | null; contract: string | null; rank: number | null };
  market: { price_usd: number; market_cap_usd: number; fully_diluted_value_usd: number; volume_24h_usd: number };
  performance: { change_1h_pct: number; change_24h_pct: number; change_7d_pct: number; change_30d_pct: number };
  technical_analysis: { trend: string; rsi_14: number; momentum_30d_pct: number; atr_14_pct: number };
  intelligence: { narrative: string; catalysts: string[]; risks: string[] };
  verdict: string;
}

export interface DeepAnalysisVerdict {
  call: string; // e.g. "constructive" — the short verdict string
  headline: string;
  bottom_line: string;
  key_driver: string;
  what_changes_it: string;
  confluence_score: number;
}

export interface DeepAnalysisData {
  market?: unknown;
  performance?: unknown;
  technical_analysis?: unknown;
  confluence?: { state: string; score: number; gates: { name: string; passed: boolean; detail?: unknown }[]; status: string };
  verdict: DeepAnalysisVerdict;
  token_profile?: unknown;
  derivatives?: unknown;
  trade_plan?: { entry: number; stop: number; targets: number[]; risk_reward: number[] } | null;
  intelligence: { narrative: string; catalysts: string[]; risks: string[] };
}

export interface CompareTokensData {
  intent: string;
  tokens: {
    symbol: string;
    name: string;
    rank: number | null;
    price_usd: number;
    changes: { h1: number; h24: number; d7: number; d30: number };
    metrics: { market_cap_usd: number; volume_24h_usd: number; rsi_14: number; atr_14_pct: number; trend: string };
    verdict: string;
  }[];
  factors: {
    key: string;
    label: string;
    winner: string;
    scores: Record<string, number>;
  }[];
  winner: string;
  conclusion: {
    pick: string;
    headline: string;
    rationale: string;
    runner_up_case: string;
    confidence: "low" | "medium" | "high";
    method: string;
  };
  coverage_by_token: Record<string, Record<string, string>>;
}

export interface SentimentShiftData {
  evidence: {
    fear_greed: {
      value: number;
      label: string;
      change_7d_points: number;
      change_direction: "up" | "down" | "flat";
      material_shift: boolean;
    };
    sentiment_regime: string;
    altseason?: { index: number; phase: string };
  };
}

class RyoToolError extends Error {
  constructor(public tool: string, public status: number, message: string) {
    super(`RYO ${tool} failed (${status}): ${message}`);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callToolOnce<TData>(tool: string, args: Record<string, unknown>, timeoutMs: number): Promise<RyoEnvelope<TData>> {
  // Vercel kills the whole function past its maxDuration with no clean error —
  // we cancel ourselves first, with margin, so the caller gets a real Error instead.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${BASE}/tools/${tool}/call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      // Live market data — never cache at the fetch layer.
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new RyoToolError(tool, 504, `timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const body = await res.json();

  if (!res.ok) {
    const retryAfterHeader = res.headers.get("Retry-After");
    const err = new RyoToolError(tool, res.status, body?.message ?? res.statusText);
    (err as RyoToolError & { retryAfterMs?: number }).retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
    throw err;
  }

  // REST envelope shape observed from the builder guide: { tool, result: {...envelope} }
  const envelope: RyoEnvelope<TData> = body.result ?? body;
  return envelope;
}

// Per the builder guide's own recommendation: exponential backoff with jitter on
// 429/503. Bounded to 2 retries so we never blow past our own per-call timeout budget.
async function callTool<TData>(tool: string, args: Record<string, unknown> = {}, timeoutMs = 45_000): Promise<RyoEnvelope<TData>> {
  const maxAttempts = 3;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await callToolOnce<TData>(tool, args, timeoutMs);
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof RyoToolError && (err.status === 429 || err.status === 503);
      if (!retryable || attempt === maxAttempts - 1) throw err;

      const explicit = (err as RyoToolError & { retryAfterMs?: number }).retryAfterMs;
      const backoff = explicit ?? 1_500 * 2 ** attempt;
      const jitter = Math.random() * 400;
      await sleep(backoff + jitter);
    }
  }

  throw lastErr;
}

// Vercel's Hobby-tier hard ceiling is 60s per function invocation. Timeouts below
// leave real margin under that so we always fail cleanly with our own error
// instead of the platform silently killing the whole request (which the browser
// only ever sees as "Failed to fetch").
export function analyzeToken(symbol: string) {
  return callTool<AnalyzeTokenData>("analyze_token", { symbol }, 20_000);
}

export function deepAnalysis(symbol: string, includePerp = false) {
  return callTool<DeepAnalysisData>("deep_analysis", { symbol, include_perp: includePerp }, 45_000);
}

export function compareTokens(symbols: string, intent?: "swing" | "hold" | "spot") {
  return callTool<CompareTokensData>("compare_tokens", intent ? { symbols, intent } : { symbols }, 45_000);
}

export function monitorMarketSentimentShift() {
  return callTool<SentimentShiftData>("monitor_market_sentiment_shift", { time_window: "7d" }, 20_000);
}

export function marketOverview() {
  return callTool<unknown>("market_overview", {});
}

export function scanMarket(opts: { chain?: string; theme?: string; top_n?: number } = {}) {
  return callTool<unknown>("scan_market", opts);
}
