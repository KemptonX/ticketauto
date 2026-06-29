// GET    /api/marketplace/accounts/[id]  — get single account (safe fields only)
// PATCH  /api/marketplace/accounts/[id]  — disconnect / reconnect
// DELETE /api/marketplace/accounts/[id]  — remove account

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { encryptCredential, encryptionKeyConfigured } from "@/src/lib/marketplace/encryption";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const { data, error } = await supabase
      .from("marketplace_accounts")
      .select(
        "id, marketplace, display_email, status, can_list, last_login_at, last_checked_at, last_successful_action_at, last_error_code, last_error_message, pending_2fa_since, created_at, updated_at, disconnected_at"
      )
      .eq("id", id)
      .eq("user_id", user.id)   // RLS + explicit check — never cross-user
      .single();

    if (error || !data) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    return NextResponse.json({ account: data });
  } catch {
    return NextResponse.json({ error: "Failed to load account" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    // Verify ownership before any write
    const { data: existing } = await supabase
      .from("marketplace_accounts")
      .select("id, user_id, marketplace, display_email")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (!existing) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    const body = await request.json() as {
      action?: "disconnect" | "reconnect" | "submit_otp";
      email?: string;
      password?: string;
      otp?: string;
    };

    if (body.action === "disconnect") {
      await supabase.from("marketplace_accounts").update({
        status: "disconnected",
        encrypted_session_data: null,
        can_list: false,
        disconnected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", id).eq("user_id", user.id);

      await supabase.from("marketplace_account_logs").insert({
        user_id: user.id,
        marketplace_account_id: id,
        action: "disconnect",
        status: "disconnected",
        message: "Account disconnected by user",
      });

      return NextResponse.json({ ok: true, status: "disconnected" });
    }

    if (body.action === "reconnect") {
      if (!encryptionKeyConfigured()) {
        return NextResponse.json({ error: "Server encryption key not configured" }, { status: 500 });
      }
      const email = body.email?.trim();
      const password = body.password;
      if (!email || !password) {
        return NextResponse.json({ error: "Email and password are required to reconnect" }, { status: 400 });
      }

      const encryptedCredentials = encryptCredential(
        JSON.stringify({ email, password })
      );

      await supabase.from("marketplace_accounts").update({
        display_email: email,
        encrypted_credentials: encryptedCredentials,
        encrypted_session_data: null,
        status: "needs_reconnect",
        can_list: false,
        last_error_code: null,
        last_error_message: null,
        pending_2fa_since: null,
        disconnected_at: null,
        updated_at: new Date().toISOString(),
      }).eq("id", id).eq("user_id", user.id);

      await supabase.from("marketplace_account_logs").insert({
        user_id: user.id,
        marketplace_account_id: id,
        action: "reconnect",
        status: "needs_reconnect",
        message: "Credentials updated. Awaiting worker verification.",
      });

      return NextResponse.json({ ok: true, status: "needs_reconnect" });
    }

    if (body.action === "submit_otp") {
      const otp = body.otp?.trim();
      if (!otp) return NextResponse.json({ error: "OTP code is required" }, { status: 400 });

      await supabase.from("marketplace_accounts").update({
        pending_otp_code: otp,
        updated_at: new Date().toISOString(),
      }).eq("id", id).eq("user_id", user.id);

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    // Ownership verified by RLS + explicit eq
    const { error } = await supabase
      .from("marketplace_accounts")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }
}
