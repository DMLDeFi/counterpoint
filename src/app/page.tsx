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
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTrail, setShowTrail] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const clean = symbol.trim();
    if (!clean) return;

    setLoading(true);
    setError(null);
    setResult(null);

    // Phase 1: fast path (analyze_token only, ~1-2s) — a complete, real debate on
    // its own. Render it immediately so the page is never sitting on a long silent
    // wait that's fragile over some networks/extensions.
    try {
      const res = await fetch(`/api/debate/${encodeURIComponent(clean)}?fast=1`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Request failed.");
      setResult(body);
      setShowTrail(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
      return;
    }
    setLoading(false);

    // Phase 2: quietly fetch the fuller version (deep_analysis + sentiment) in the
    // background and upgrade in place if it arrives. If it fails or times out for
    // any reason, the fast result shown above stays exactly as it is — no crash,
    // no broken state, nothing for the user to notice.
    setEnriching(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(`/api/debate/${encodeURIComponent(clean)}`, { signal: controller.signal });
      const text = await res.text();
      const body = JSON.parse(text.trim());
      if (res.ok && !body.error) setResult(body);
    } catch {
      // Silent — the fast result already shown is complete and valid on its own.
    } finally {
      clearTimeout(timeout);
      setEnriching(false);
    }
  }

  return (
    <div className="relative flex flex-1 flex-col bg-black">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_60%_60%_at_50%_-10%,rgba(16,185,129,0.12),transparent),radial-gradient(ellipse_50%_50%_at_80%_0%,rgba(244,63,94,0.10),transparent)]" />
      <main className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-12 sm:px-6">
        <header className="space-y-4">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-900/60 px-3 py-1 text-xs text-neutral-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live on RYO-CHAN &middot; no external LLM &middot; RYO-CHAN Hackathon 2026
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-50 sm:text-4xl">
            <span className="text-emerald-400">Bull</span>
            <span className="text-neutral-600"> vs </span>
            <span className="text-rose-400">Bear</span>
            <span className="text-neutral-50">, argued honestly.</span>
          </h1>
          <p className="max-w-prose text-sm text-neutral-400">
            A bull agent and a bear agent argue a token using RYO-CHAN&apos;s live read-only market data.
            A judge weighs the evidence. Every claim traces back to a real, named field — nothing here is invented.
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

        <div className="-mt-4 flex flex-wrap gap-2">
          {["SOL", "BTC", "AVAX", "ETH"].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSymbol(s)}
              className="rounded-md border border-neutral-800 px-2.5 py-1 font-mono text-xs text-neutral-500 transition hover:border-neutral-600 hover:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-600"
            >
              {s}
            </button>
          ))}
        </div>

        {!result && !loading && !error && (
          <div className="grid gap-4 border-t border-neutral-900 pt-8 sm:grid-cols-3">
            {[
              { n: "01", t: "Pick a token", d: "Type a symbol or tap one above. RYO pulls live market data — nothing cached." },
              { n: "02", t: "Two agents argue", d: "Bull and bear each build a weighted case from real fields: RSI, confluence, catalysts, risk." },
              { n: "03", t: "A judge decides", d: "Scores are compared, RYO's own model verdict is shown alongside — agree or diverge, both are shown." },
            ].map((step) => (
              <div key={step.n}>
                <p className="font-mono text-xs text-neutral-600">{step.n}</p>
                <p className="mt-1 text-sm font-medium text-neutral-200">{step.t}</p>
                <p className="mt-1 text-xs leading-relaxed text-neutral-500">{step.d}</p>
              </div>
            ))}
          </div>
        )}

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
              {enriching && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-500" />
                  Fetching deeper evidence (confluence, sentiment) in the background — this view already reflects a complete debate either way.
                </p>
              )}
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
