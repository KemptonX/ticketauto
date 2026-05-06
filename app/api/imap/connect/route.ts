import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json({ error: "IMAP connections are no longer supported" }, { status: 410 });
}
