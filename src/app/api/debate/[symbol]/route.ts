import { NextResponse } from "next/server";
import { runDebate } from "@/lib/debate";

export const dynamic = "force-dynamic"; // live market data — never statically cache

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;

  if (!symbol || !/^[A-Za-z0-9]{1,10}$/.test(symbol)) {
    return NextResponse.json({ error: "Invalid symbol." }, { status: 400 });
  }

  try {
    const result = await runDebate(symbol);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
