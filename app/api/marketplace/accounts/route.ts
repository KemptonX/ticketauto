// GET  /api/marketplace/accounts       — list user's connected marketplace accounts
// POST /api/marketplace/accounts       — connect a new Viagogo account

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { encryptCredential, encryptionKeyConfigured } from "@/src/lib/marketplace/encryption";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const { data, error } = await supabase
      .from("marketplace_accounts")
      .select(
        "id, marketplace, display_email, status, can_list, last_login_at, last_checked_at, last_error_message, pending_2fa_since, created_at, updated_at, disconnected_at"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ accounts: data ?? [] });
  } catch {
    return NextResponse.json({ error: "Failed to load accounts" }, { status: 500 });
  }
}

type ConnectBody = {
  marketplace?: string;
  email?: string;
  password?: string;
};

export async function POST(request: NextRequest) {
  try {
    if (!encryptionKeyConfigured()) {
      return NextResponse.json(
        { error: "Server encryption key not configured. Contact support." },
        { status: 500 }
      );
    }

    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const body = (await request.json()) as ConnectBody;
    const marketplace = body.marketplace?.trim() || "viagogo";
    const email = body.email?.trim();
    const password = body.password;

    if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });
    if (!password || password.length < 4) {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }

    // Encrypt credentials — never stored as plaintext
    const encryptedCredentials = encryptCredential(
      JSON.stringify({ email, password })
    );

    // Upsert: if account for this marketplace already exists, update it
    const { data: upserted, error: upsertError } = await supabase
      .from("marketplace_accounts")
      .upsert(
        {
          user_id: user.id,
          marketplace,
          display_email: email,
          encrypted_credentials: encryptedCredentials,
          encrypted_session_data: null,            // cleared on reconnect; worker re-logs in
          status: "needs_reconnect",
          can_list: false,
          last_error_code: null,
          last_error_message: null,
          pending_2fa_since: null,
          disconnected_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,marketplace" }
      )
      .select("id, status, display_email")
      .single();

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    // Audit log
    await supabase.from("marketplace_account_logs").insert({
      user_id: user.id,
      marketplace_account_id: upserted.id,
      action: "connect",
      status: "needs_reconnect",
      message: `Account added for ${email}. Awaiting worker connection verification.`,
    });

    // Do not return any credential data — only the safe account row
    return NextResponse.json({
      ok: true,
      account: {
        id: upserted.id,
        status: "needs_reconnect",
        display_email: email,
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to save account" }, { status: 500 });
  }
}
