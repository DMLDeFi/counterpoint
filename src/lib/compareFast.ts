// Fast comparison, built client-request-side from parallel analyze_token calls
// (~1-2s each) instead of RYO's compare_tokens (30-55s). Same factor set and
// same shape as CompareTokensData so the UI doesn't need to know which source
// produced it — labeled honestly as an estimate in the UI, and RYO's own
// compare_tokens result silently upgrades it in place when it arrives.
import "server-only";
import { analyzeToken, type AnalyzeTokenData, type CompareTokensData } from "./ryo";

export async function buildFastComparison(symbols: string[], intent: string): Promise<CompareTokensData> {
  const analyses = await Promise.all(symbols.map((s) => analyzeToken(s)));

  const tokens: CompareTokensData["tokens"] = analyses.map((a: { data: AnalyzeTokenData }) => ({
    symbol: a.data.asset.symbol,
    name: a.data.asset.name,
    rank: a.data.asset.rank,
    price_usd: a.data.market.price_usd,
    changes: {
      h1: a.data.performance.change_1h_pct,
      h24: a.data.performance.change_24h_pct,
      d7: a.data.performance.change_7d_pct,
      d30: a.data.performance.change_30d_pct,
    },
    metrics: {
      market_cap_usd: a.data.market.market_cap_usd,
      volume_24h_usd: a.data.market.volume_24h_usd,
      rsi_14: a.data.technical_analysis.rsi_14,
      atr_14_pct: a.data.technical_analysis.atr_14_pct,
      trend: a.data.technical_analysis.trend,
    },
    verdict: a.data.verdict,
  }));

  function winnerOf(scores: Record<string, number>): string {
    return Object.entries(scores).reduce((best, [sym, val]) => (val > scores[best] ? sym : best), tokens[0].symbol);
  }

  const momentum = Object.fromEntries(tokens.map((t) => [t.symbol, t.changes.d7]));
  const marketActivity = Object.fromEntries(tokens.map((t) => [t.symbol, t.metrics.volume_24h_usd / t.metrics.market_cap_usd]));
  const volatility = Object.fromEntries(tokens.map((t) => [t.symbol, -t.metrics.atr_14_pct])); // lower ATR = higher (better) score

  const factors: CompareTokensData["factors"] = [
    { key: "momentum", label: "Momentum / relative strength", winner: winnerOf(momentum), scores: momentum },
    { key: "market_activity", label: "Market activity", winner: winnerOf(marketActivity), scores: marketActivity },
    { key: "volatility", label: "Lower measured volatility", winner: winnerOf(volatility), scores: volatility },
  ];

  const wins: Record<string, number> = Object.fromEntries(tokens.map((t) => [t.symbol, 0]));
  for (const f of factors) wins[f.winner]++;
  const overallWinner = Object.entries(wins).reduce((best, [sym, n]) => (n > wins[best] ? sym : best), tokens[0].symbol);
  const wonLabels = factors.filter((f) => f.winner === overallWinner).map((f) => f.label);
  const runnerUp = tokens.find((t) => t.symbol !== overallWinner);

  return {
    intent,
    tokens,
    factors,
    winner: overallWinner,
    conclusion: {
      pick: overallWinner,
      headline: `${overallWinner} leads this comparison.`,
      rationale: wonLabels.length > 0 ? `It leads on ${wonLabels.join(", ")}.` : "Factors are split evenly.",
      runner_up_case: runnerUp ? `${runnerUp.symbol} can take the lead if the measured factors rotate.` : "",
      confidence: "medium",
      method: "fast_estimate",
    },
    coverage_by_token: Object.fromEntries(tokens.map((t) => [t.symbol, { market_data: "available", token_profile: "not_requested" }])),
  };
}
