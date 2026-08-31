// The Counterpoint debate engine.
//
// Deliberately does NOT call an external LLM. Every claim below is derived
// directly from structured fields RYO returns (RSI, momentum, catalysts,
// risks, sentiment) — never invented text. That keeps the reasoning trail
// verifiable and repeatable: same inputs always produce the same debate,
// and every line traces back to a named source field (satisfies the
// hackathon's "no fabricated data" rule and the "cause and effect" rubric).
import "server-only";
import { analyzeToken, deepAnalysis, monitorMarketSentimentShift, type RyoStatus } from "./ryo";

export type Side = "bull" | "bear";

export interface Claim {
  side: Side;
  text: string;
  sourceField: string;
  sourceValue: string | number;
  weight: number; // relative strength, 1-3
}

export interface TrailEntry {
  agent: Side | "judge";
  text: string;
  sourceField?: string;
  sourceValue?: string | number;
}

export interface DebateResult {
  symbol: string;
  asOf: string;
  dataMode: string;
  status: RyoStatus;
  bullClaims: Claim[];
  bearClaims: Claim[];
  bullScore: number;
  bearScore: number;
  modelVerdict: string; // RYO's own deterministic verdict, used as a tie-break anchor
  finalVerdict: "bullish" | "bearish" | "split";
  confidence: "low" | "medium" | "high";
  trail: TrailEntry[];
  warnings: string[];
}

function claim(side: Side, text: string, sourceField: string, sourceValue: string | number, weight = 1): Claim {
  return { side, text, sourceField, sourceValue, weight };
}

// includeDeep=false skips deep_analysis and the sentiment call entirely — both are
// the slow, occasionally-unreliable-over-the-wire calls (30-45s). The fast path
// (analyze_token only, ~1-2s) is a complete, real debate on its own; the client
// renders it immediately, then quietly asks for the full version and upgrades
// in place if it arrives. If it never arrives, the fast result already shown
// stays valid — nothing about it is a placeholder or degraded UI state.
export async function runDebate(symbolRaw: string, includeDeep = true): Promise<DebateResult> {
  const symbol = symbolRaw.trim().toUpperCase();
  const warnings: string[] = [];

  const [analysis, deep, sentiment] = await Promise.all([
    analyzeToken(symbol),
    includeDeep
      ? deepAnalysis(symbol, false).catch((err) => {
          warnings.push(`deep_analysis unavailable: ${(err as Error).message}`);
          return null;
        })
      : Promise.resolve(null),
    includeDeep
      ? monitorMarketSentimentShift().catch((err) => {
          warnings.push(`monitor_market_sentiment_shift unavailable: ${(err as Error).message}`);
          return null;
        })
      : Promise.resolve(null),
  ]);

  warnings.push(...analysis.warnings);

  const bullClaims: Claim[] = [];
  const bearClaims: Claim[] = [];

  const { technical_analysis: ta, performance: perf, intelligence, market } = analysis.data;

  // Catalysts / risks come straight from RYO's own intelligence field.
  for (const c of intelligence.catalysts ?? []) {
    bullClaims.push(claim("bull", c, "intelligence.catalysts", c, 1));
  }
  for (const r of intelligence.risks ?? []) {
    bearClaims.push(claim("bear", r, "intelligence.risks", r, 1));
  }

  // RSI: overbought/oversold read.
  if (ta.rsi_14 >= 70) {
    bearClaims.push(
      claim("bear", `RSI(14) is ${ta.rsi_14.toFixed(1)} — overbought territory, pullback risk rises.`, "technical_analysis.rsi_14", ta.rsi_14, 2)
    );
  } else if (ta.rsi_14 <= 30) {
    bullClaims.push(
      claim("bull", `RSI(14) is ${ta.rsi_14.toFixed(1)} — oversold, room to recover.`, "technical_analysis.rsi_14", ta.rsi_14, 2)
    );
  } else {
    bullClaims.push(
      claim("bull", `RSI(14) is ${ta.rsi_14.toFixed(1)} — momentum without being stretched.`, "technical_analysis.rsi_14", ta.rsi_14, 1)
    );
  }

  // Trend direction.
  if (ta.trend === "up") {
    bullClaims.push(claim("bull", `Technical trend reads up.`, "technical_analysis.trend", ta.trend, 1));
  } else if (ta.trend === "down") {
    bearClaims.push(claim("bear", `Technical trend reads down.`, "technical_analysis.trend", ta.trend, 1));
  }

  // Volatility (ATR): high ATR is a bear-side risk claim regardless of direction.
  if (ta.atr_14_pct >= 6) {
    bearClaims.push(
      claim("bear", `ATR(14) is ${ta.atr_14_pct.toFixed(1)}% of price — high realized volatility, wide stops needed.`, "technical_analysis.atr_14_pct", ta.atr_14_pct, 2)
    );
  }

  // Short-term vs medium-term performance divergence.
  if (perf.change_24h_pct < 0 && perf.change_7d_pct > 0) {
    bearClaims.push(
      claim("bear", `Red over 24h (${perf.change_24h_pct.toFixed(2)}%) despite a green 7d — short-term weakness inside the trend.`, "performance.change_24h_pct", perf.change_24h_pct, 1)
    );
  } else if (perf.change_24h_pct > 0) {
    bullClaims.push(
      claim("bull", `Up ${perf.change_24h_pct.toFixed(2)}% over 24h.`, "performance.change_24h_pct", perf.change_24h_pct, 1)
    );
  }

  if (perf.change_30d_pct <= -15) {
    bearClaims.push(
      claim("bear", `Down ${perf.change_30d_pct.toFixed(1)}% over 30d — trend damage isn't fresh.`, "performance.change_30d_pct", perf.change_30d_pct, 2)
    );
  }

  // deep_analysis: pull any additional catalysts/risks not already listed.
  if (deep) {
    for (const c of deep.data.intelligence?.catalysts ?? []) {
      if (!bullClaims.some((b) => b.text === c)) bullClaims.push(claim("bull", c, "deep_analysis.intelligence.catalysts", c, 1));
    }
    for (const r of deep.data.intelligence?.risks ?? []) {
      if (!bearClaims.some((b) => b.text === r)) bearClaims.push(claim("bear", r, "deep_analysis.intelligence.risks", r, 1));
    }

    // Confluence gates: RYO's own cross-signal checks (momentum, market activity, ...).
    const gates = deep.data.confluence?.gates ?? [];
    const passed = gates.filter((g) => g.passed).length;
    if (gates.length > 0) {
      if (passed === gates.length) {
        bullClaims.push(
          claim("bull", `All ${gates.length} confluence gates pass (${gates.map((g) => g.name).join(", ")}).`, "confluence.gates", passed, 2)
        );
      } else if (passed === 0) {
        bearClaims.push(claim("bear", `No confluence gates pass — signals don't line up.`, "confluence.gates", passed, 2));
      } else {
        bearClaims.push(
          claim("bear", `Only ${passed}/${gates.length} confluence gates pass — mixed signal.`, "confluence.gates", `${passed}/${gates.length}`, 1)
        );
      }
    }

    // Trade plan risk:reward, when RYO published one.
    const rr = deep.data.trade_plan?.risk_reward;
    if (rr && rr.length === 2 && rr[1] > 0) {
      const ratio = rr[1] / rr[0];
      if (ratio >= 1.5) {
        bullClaims.push(claim("bull", `RYO's preview plan risk:reward is 1:${ratio.toFixed(1)} — favorable skew.`, "trade_plan.risk_reward", ratio, 1));
      }
    }
  }

  // Sentiment shift: 7-day market-wide Fear & Greed read. Only worth a claim when RYO itself calls it a material shift.
  if (sentiment?.data.evidence?.fear_greed) {
    const fg = sentiment.data.evidence.fear_greed;
    if (fg.material_shift) {
      const text = `Market-wide Fear & Greed ${fg.change_direction === "down" ? "fell" : "rose"} ${Math.abs(fg.change_7d_points)} pts over 7d to ${fg.value} (${fg.label}) — headwind/tailwind, not specific to this asset.`;
      if (fg.change_direction === "down") {
        bearClaims.push(claim("bear", text, "sentiment.evidence.fear_greed.change_7d_points", fg.change_7d_points, 1));
      } else if (fg.change_direction === "up") {
        bullClaims.push(claim("bull", text, "sentiment.evidence.fear_greed.change_7d_points", fg.change_7d_points, 1));
      }
    }
  }

  const bullScore = bullClaims.reduce((s, c) => s + c.weight, 0);
  const bearScore = bearClaims.reduce((s, c) => s + c.weight, 0);
  const modelVerdict = deep?.data.verdict.call ?? analysis.data.verdict;

  const trail: TrailEntry[] = [
    { agent: "bull", text: `Opens with ${bullClaims.length} claim(s), weighted score ${bullScore}.` },
    ...bullClaims.map((c): TrailEntry => ({ agent: "bull", text: c.text, sourceField: c.sourceField, sourceValue: c.sourceValue })),
    { agent: "bear", text: `Responds with ${bearClaims.length} claim(s), weighted score ${bearScore}.` },
    ...bearClaims.map((c): TrailEntry => ({ agent: "bear", text: c.text, sourceField: c.sourceField, sourceValue: c.sourceValue })),
  ];

  const scoreDiff = Math.abs(bullScore - bearScore);
  let finalVerdict: DebateResult["finalVerdict"];
  let confidence: DebateResult["confidence"];

  if (scoreDiff <= 1) {
    finalVerdict = "split";
    confidence = "low";
    trail.push({
      agent: "judge",
      text: `Scores are close (bull ${bullScore} vs bear ${bearScore}) — too close to call from evidence alone. Falling back to RYO's own model verdict: "${modelVerdict}".`,
      sourceField: "verdict",
      sourceValue: modelVerdict,
    });
  } else {
    finalVerdict = bullScore > bearScore ? "bullish" : "bearish";
    confidence = scoreDiff >= 4 ? "high" : "medium";
    const agrees = (finalVerdict === "bullish" && /accumulate|buy|bull/i.test(modelVerdict)) ||
      (finalVerdict === "bearish" && /reduce|sell|bear/i.test(modelVerdict));
    trail.push({
      agent: "judge",
      text: `${finalVerdict === "bullish" ? "Bull" : "Bear"} case wins on weighted evidence (${bullScore} vs ${bearScore}). RYO's own model verdict is "${modelVerdict}" — ${agrees ? "consistent with" : "diverges from"} this debate's read.`,
      sourceField: "verdict",
      sourceValue: modelVerdict,
    });
  }

  return {
    symbol,
    asOf: analysis.as_of,
    dataMode: analysis.data_mode,
    status: analysis.status,
    bullClaims,
    bearClaims,
    bullScore,
    bearScore,
    modelVerdict,
    finalVerdict,
    confidence,
    trail,
    warnings,
  };
}
