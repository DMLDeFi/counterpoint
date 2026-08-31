"use client";

import { useState, type FormEvent } from "react";

interface TokenRow {
  symbol: string;
  name: string;
  rank: number | null;
  price_usd: number;
  changes: { h1: number; h24: number; d7: number; d30: number };
  metrics: { market_cap_usd: number; volume_24h_usd: number; rsi_14: number; atr_14_pct: number; trend: string };
  verdict: string;
}

interface Factor {
  key: string;
  label: string;
  winner: string;
  scores: Record<string, number>;
}

interface CompareResult {
  intent: string;
  tokens: TokenRow[];
  factors: Factor[];
  winner: string;
  conclusion: { pick: string; headline: string; rationale: string; runner_up_case: string; confidence: string; method: string };
}

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40",
  medium: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40",
  low: "bg-neutral-500/15 text-neutral-300 ring-1 ring-neutral-500/40",
};

function fmtUsd(n: number) {
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export default function ComparePage() {
  const [symbolsInput, setSymbolsInput] = useState("");
  const [intent, setIntent] = useState<"swing" | "hold" | "spot">("swing");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const symbols = symbolsInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (symbols.length < 2) {
      setError("Enter at least two symbols, comma-separated (e.g. SOL, AVAX).");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    const symbolsParam = encodeURIComponent(symbols.join(","));

    // Phase 1: fast path — parallel analyze_token calls (~1-2s), factors computed
    // in-house. A complete, real comparison, just not RYO's official scoring yet.
    try {
      const res = await fetch(`/api/compare/${symbolsParam}?intent=${intent}&fast=1`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Request failed.");
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
      return;
    }
    setLoading(false);

    // Phase 2: quietly fetch RYO's own compare_tokens result and upgrade in place.
    // If it fails or times out, the fast comparison already shown stays valid.
    setEnriching(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(`/api/compare/${symbolsParam}?intent=${intent}`, { signal: controller.signal });
      const text = await res.text();
      const body = JSON.parse(text.trim());
      if (res.ok && !body.error) setResult(body);
    } catch {
      // Silent — the fast comparison already shown is complete and valid on its own.
    } finally {
      clearTimeout(timeout);
      setEnriching(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col bg-black">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-12 sm:px-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">Compare</h1>
          <p className="max-w-prose text-sm text-neutral-400">
            Compare 2–4 tokens on momentum, market activity, and measured volatility — RYO&apos;s own deterministic
            scoring, not a narrative model.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-wrap gap-2">
          <label htmlFor="symbols" className="sr-only">
            Token symbols, comma-separated
          </label>
          <input
            id="symbols"
            value={symbolsInput}
            onChange={(e) => setSymbolsInput(e.target.value)}
            placeholder="SOL, AVAX, BNB…"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-600"
          />
          <label htmlFor="intent" className="sr-only">
            Intent
          </label>
          <select
            id="intent"
            value={intent}
            onChange={(e) => setIntent(e.target.value as "swing" | "hold" | "spot")}
            className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-neutral-100 focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-600"
          >
            <option value="swing">swing</option>
            <option value="hold">hold</option>
            <option value="spot">spot</option>
          </select>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-neutral-100 px-5 py-2.5 font-medium text-neutral-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Comparing…" : "Compare"}
          </button>
        </form>

        {loading && <p className="text-sm text-neutral-500">Pulling live data from RYO…</p>}

        {error && (
          <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-300">
            {error}
            {/RATE LIMIT|429/i.test(error) && (
              <p className="mt-2 text-xs text-rose-400/80">
                RYO&apos;s own rate limit, not this app — likely heavy traffic near the hackathon deadline. Wait 20–30s and try again.
              </p>
            )}
          </div>
        )}

        {result && (
          <section className="space-y-8" aria-live="polite">
            {/* Conclusion — the 30-second read */}
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-lg font-semibold text-neutral-50">{result.conclusion.headline}</p>
                <span className={`rounded-full px-3 py-1 text-sm font-medium ${CONFIDENCE_STYLE[result.conclusion.confidence] ?? CONFIDENCE_STYLE.low}`}>
                  {result.conclusion.confidence} confidence
                </span>
              </div>
              <p className="mt-2 text-sm text-neutral-400">{result.conclusion.rationale}</p>
              <p className="mt-1 text-xs text-neutral-500">{result.conclusion.runner_up_case}</p>
              <p className="mt-3 text-xs text-neutral-600">
                {result.conclusion.method === "fast_estimate"
                  ? "Computed in-house from live analyze_token calls (fast path)."
                  : "RYO's own deterministic compare_tokens scoring."}
              </p>
              {enriching && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-500" />
                  Fetching RYO&apos;s official comparison in the background — this view already reflects a real comparison either way.
                </p>
              )}
            </div>

            {/* Factor breakdown, sorted by importance (order RYO returns them in) */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-neutral-800 text-left text-neutral-500">
                    <th className="py-2 pr-4 font-medium">Factor</th>
                    {result.tokens.map((t) => (
                      <th key={t.symbol} className="py-2 pr-4 font-medium">
                        {t.symbol}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.factors.map((f) => (
                    <tr key={f.key} className="border-b border-neutral-900">
                      <td className="py-2 pr-4 text-neutral-300">{f.label}</td>
                      {result.tokens.map((t) => {
                        const isWinner = f.winner === t.symbol;
                        return (
                          <td key={t.symbol} className={`py-2 pr-4 font-mono ${isWinner ? "text-emerald-400" : "text-neutral-500"}`}>
                            {f.scores[t.symbol]?.toFixed(2) ?? "—"}
                            {isWinner && " ▲"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Per-token detail cards */}
            <div className="grid gap-4 sm:grid-cols-2">
              {result.tokens.map((t) => (
                <div key={t.symbol} className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-4">
                  <div className="flex items-baseline justify-between">
                    <p className="font-mono text-sm font-semibold text-neutral-100">{t.symbol}</p>
                    <p className="text-xs text-neutral-500">{t.verdict}</p>
                  </div>
                  <p className="mt-1 text-lg text-neutral-50">${t.price_usd.toFixed(2)}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-400">
                    <dt>24h</dt>
                    <dd className={t.changes.h24 >= 0 ? "text-emerald-400" : "text-rose-400"}>{fmtPct(t.changes.h24)}</dd>
                    <dt>7d</dt>
                    <dd className={t.changes.d7 >= 0 ? "text-emerald-400" : "text-rose-400"}>{fmtPct(t.changes.d7)}</dd>
                    <dt>RSI(14)</dt>
                    <dd>{t.metrics.rsi_14.toFixed(1)}</dd>
                    <dt>Mkt cap</dt>
                    <dd>{fmtUsd(t.metrics.market_cap_usd)}</dd>
                  </dl>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
