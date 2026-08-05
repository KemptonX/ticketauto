import { NextResponse } from "next/server";
import { getGbpRates } from "@/src/lib/exchange";

export const revalidate = 3600;

export async function GET() {
  const rates = await getGbpRates();
  return NextResponse.json({ rates }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
