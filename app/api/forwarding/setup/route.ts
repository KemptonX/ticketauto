import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

const INBOUND_DOMAIN = "inbound.tixtracker.app";
const FORWARDING_PREFIX = "scan+";

function generateToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function makeForwardingEmail(token: string): string {
  return `${FORWARDING_PREFIX}${token}@${INBOUND_DOMAIN}`;
}

const SELECT_COLS = "id, forwarding_email, forwarding_token, status, last_received_at, last_successful_import_at, latest_verification_code, latest_verification_link, latest_verification_received_at, created_at";

// GET — return existing settings, or create a new token if none exists
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: existing } = await supabase
    .from("email_forwarding_settings")
    .select(SELECT_COLS)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ setting: existing });
  }

  // First visit — generate and persist. The RLS INSERT policy has `with check (true)`
  // so the authenticated user client can insert without the service role.
  const token = generateToken();
  const email = makeForwardingEmail(token);

  const { data: created, error } = await supabase
    .from("email_forwarding_settings")
    .insert({ user_id: user.id, forwarding_token: token, forwarding_email: email, status: "active" })
    .select(SELECT_COLS)
    .single();

  if (error || !created) {
    console.error("forwarding/setup insert error:", error?.message);
    return NextResponse.json({ error: "Failed to create forwarding settings" }, { status: 500 });
  }

  return NextResponse.json({ setting: created });
}

// POST with { action: "regenerate" } — rotate the token in-place
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { action?: string };
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (body.action !== "regenerate") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const newToken = generateToken();
  const newEmail = makeForwardingEmail(newToken);

  const { data: updated, error } = await supabase
    .from("email_forwarding_settings")
    .update({ forwarding_token: newToken, forwarding_email: newEmail, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .select(SELECT_COLS)
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "Failed to regenerate forwarding email" }, { status: 500 });
  }

  return NextResponse.json({ setting: updated });
}
