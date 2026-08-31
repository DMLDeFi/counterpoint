import { NextResponse } from "next/server";
import { compareTokens } from "@/lib/ryo";
import { streamJsonResponse } from "@/lib/streamJson";

export const dynamic = "force-dynamic"; // live market data — never statically cache
// compare_tokens has been observed taking 40-55s server-side on RYO's end.
// Raise the Vercel function budget to the Hobby-tier max so it isn't killed mid-call.
export const maxDuration = 60;

const VALID_INTENTS = new Set(["swing", "hold", "spot"]);

export async function GET(req: Request, { params }: { params: Promise<{ symbols: string }> }) {
  const { symbols } = await params;
  const decoded = decodeURIComponent(symbols);
  const list = decoded.split(",").map((s) => s.trim()).filter(Boolean);

  if (list.length < 2 || list.length > 4 || list.some((s) => !/^[A-Za-z0-9]{1,10}$/.test(s))) {
    return NextResponse.json({ error: "Supply 2 to 4 valid token symbols, comma-separated." }, { status: 400 });
  }

  const intentParam = new URL(req.url).searchParams.get("intent");
  const intent = intentParam && VALID_INTENTS.has(intentParam) ? (intentParam as "swing" | "hold" | "spot") : undefined;

  return streamJsonResponse(() => compareTokens(list.join(", "), intent));
}
