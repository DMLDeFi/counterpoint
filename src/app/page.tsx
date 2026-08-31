"use client";

import { useState, type FormEvent } from "react";

interface Claim {
  side: "bull" | "bear";
  text: string;
  sourceField: string;
  sourceValue: string | number;
  weight: number;
}

interface TrailEntry {
  agent: "bull" | "bear" | "judge";
  text: string;
  sourceField?: string;
  sourceValue?: string | number;
}

interface DebateResult {
  symbol: string;
  asOf: string;
  dataMode: string;
  status: string;
  bullClaims: Claim[];
  bearClaims: Claim[];
  bullScore: number;
  bearScore: number;
  modelVerdict: string;
  finalVerdict: "bullish" | "bearish" | "split";
  confidence: "low" | "medium" | "high";
  trail: TrailEntry[];
  warnings: string[];
}

const VERDICT_STYLE: Record<DebateResult["finalVerdict"], string> = {
  bullish: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40",
  bearish: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/40",
  split: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40",
};

function ClaimList({ claims, side }: { claims: Claim[]; side: "bull" | "bear" }) {
  const sorted = [...claims].sort((a, b) => b.weight - a.weight);
  const accent = side === "bull" ? "border-emerald-500/30" : "border-rose-500/30";

  if (sorted.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No {side} case found in the evidence.</p>;
  }

  return (
    <ul className="space-y-2">
      {sorted.map((c, i) => (
        <li key={i} className={`rounded-lg border ${accent} bg-neutral-900/60 p-3`}>
          <p className="text-sm text-neutral-100">{c.text}</p>
          <p className="mt-1 font-mono text-xs text-neutral-500">
            {c.sourceField} = {String(c.sourceValue)}
          </p>
        </li>
      ))}
    </ul>
  );
}

export default function Home() {
  const [symbol, setSymbol] = useState("");
  const [result, setResult] = useState<DebateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTrail, setShowTrail] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const clean = symbol.trim();
    if (!clean) return;

    setLoading(true);
    setError(null);
    setResult(null);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 65_000);

    try {
      const res = await fetch(`/api/debate/${encodeURIComponent(clean)}`, { signal: controller.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Request failed.");
      setResult(body);
      setShowTrail(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("RYO's evidence pack took too long to respond (over 65s). Try again — this is a slow-tool timeout, not a crash.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col bg-black">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-12 sm:px-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">Counterpoint</h1>
          <p className="max-w-prose text-sm text-neutral-400">
            A bull agent and a bear agent argue a token using RYO-CHAN&apos;s live read-only market data.
            A judge weighs the evidence. Every claim below traces back to a real, named field — nothing here is invented.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <label htmlFor="symbol" className="sr-only">
            Token symbol
          </label>
          <input
            id="symbol"
            name="symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="SOL, BTC, AVAX…"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-600"
          />
          <button
            type="submit"
            disabled={loading || !symbol.trim()}
            className="rounded-lg bg-neutral-100 px-5 py-2.5 font-medium text-neutral-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Debating…" : "Debate"}
          </button>
        </form>

        {loading && (
          <p className="text-sm text-neutral-500">
            Running the full evidence pack (deep analysis can take 30–40s) — pulling live data, not cached.
          </p>
        )}

        {error && (
          <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-300">
            {error}
          </div>
        )}

        {result && (
          <section className="space-y-8" aria-live="polite">
            {/* Verdict — the 30-second read */}
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-xs uppercase tracking-wide text-neutral-500">{result.symbol}</p>
                  <p className="mt-1 text-lg font-semibold text-neutral-50">
                    Debate score: bull {result.bullScore} — bear {result.bearScore}
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-sm font-medium ${VERDICT_STYLE[result.finalVerdict]}`}>
                  {result.finalVerdict} · {result.confidence} confidence
                </span>
              </div>
              <p className="mt-3 text-sm text-neutral-400">
                RYO&apos;s own model verdict: <span className="font-mono text-neutral-300">{result.modelVerdict}</span> · data mode{" "}
                <span className="font-mono text-neutral-300">{result.dataMode}</span> · as of{" "}
                <time dateTime={result.asOf} className="font-mono text-neutral-300">
                  {new Date(result.asOf).toLocaleString()}
                </time>
              </p>
              {result.warnings.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-neutral-800 pt-3">
                  {result.warnings.map((w, i) => (
                    <li key={i} className="text-xs text-amber-400">
                      ⚠ {w}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* The two cases */}
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-emerald-400">
                  Bull case ({result.bullClaims.length})
                </h2>
                <ClaimList claims={result.bullClaims} side="bull" />
              </div>
              <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-rose-400">
                  Bear case ({result.bearClaims.length})
                </h2>
                <ClaimList claims={result.bearClaims} side="bear" />
              </div>
            </div>

            {/* Full reasoning trail, expandable */}
            <div>
              <button
                type="button"
                onClick={() => setShowTrail((v) => !v)}
                className="rounded text-sm font-medium text-neutral-400 underline decoration-neutral-700 underline-offset-4 hover:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-600"
                aria-expanded={showTrail}
              >
                {showTrail ? "Hide" : "Show"} full reasoning trail ({result.trail.length} steps)
              </button>
              {showTrail && (
                <ol className="mt-4 space-y-2 border-l border-neutral-800 pl-4">
                  {result.trail.map((t, i) => (
                    <li key={i} className="text-sm">
                      <span
                        className={`mr-2 font-mono text-xs uppercase ${
                          t.agent === "bull" ? "text-emerald-400" : t.agent === "bear" ? "text-rose-400" : "text-neutral-300"
                        }`}
                      >
                        {t.agent}
                      </span>
                      <span className="text-neutral-300">{t.text}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
