import { NextResponse } from "next/server";
import { compareTokens } from "@/lib/ryo";
import { buildFastComparison } from "@/lib/compareFast";
import { streamJsonResponse } from "@/lib/streamJson";

export const dynamic = "force-dynamic"; // live market data — never statically cache
// compare_tokens has been observed taking 40-55s server-side on RYO's end.
// Raise the Vercel function budget to the Hobby-tier max so it isn't killed mid-call.
export const maxDuration = 60;

const VALID_INTENTS = new Set(["swing", "hold", "spot"]);

function parseSymbols(raw: string): string[] {
  return decodeURIComponent(raw).split(",").map((s) => s.trim()).filter(Boolean);
}

export async function GET(req: Request, { params }: { params: Promise<{ symbols: string }> }) {
  const { symbols } = await params;
  const list = parseSymbols(symbols);

  if (list.length < 2 || list.length > 4 || list.some((s) => !/^[A-Za-z0-9]{1,10}$/.test(s))) {
    return NextResponse.json({ error: "Supply 2 to 4 valid token symbols, comma-separated." }, { status: 400 });
  }

  const url = new URL(req.url);
  const intentParam = url.searchParams.get("intent");
  const intent = intentParam && VALID_INTENTS.has(intentParam) ? (intentParam as "swing" | "hold" | "spot") : "swing";
  const fast = url.searchParams.get("fast") === "1";

  // Fast path: parallel analyze_token calls (~1-2s), factors computed in-house.
  if (fast) {
    try {
      const result = await buildFastComparison(list, intent);
      return NextResponse.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  return streamJsonResponse(() => compareTokens(list.join(", "), intent as "swing" | "hold" | "spot"));
}
