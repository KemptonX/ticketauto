import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { testImapConnection, safeError } from "@/src/lib/imap-sync";

export const runtime = "nodejs";

type ConnectBody = {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  use_tls?: boolean;
  mailbox?: string;
  unread_only?: boolean;
  mark_read?: boolean;
  label?: string;
};

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const body = (await request.json()) as ConnectBody;
    const host = body.host?.trim();
    const port = Number(body.port) || 993;
    const username = body.username?.trim();
    const password = body.password;
    const use_tls = body.use_tls !== false;
    const mailbox = body.mailbox?.trim() || "INBOX";
    const unread_only = body.unread_only !== false;
    const mark_read = body.mark_read === true;
    const label = body.label?.trim() || null;

    if (!host) return NextResponse.json({ error: "Host is required" }, { status: 400 });
    if (!username) return NextResponse.json({ error: "Username is required" }, { status: 400 });
    if (!password) return NextResponse.json({ error: "Password is required" }, { status: 400 });

    // Test the connection before saving
    try {
      await testImapConnection({ host, port, username, password, use_tls, mailbox, unread_only, mark_read });
    } catch (err) {
      return NextResponse.json(
        { error: `Connection failed: ${safeError(err, password)}` },
        { status: 422 },
      );
    }

    // Upsert on (user_id, host, username) — updating password/settings if already exists
    const { error: dbError } = await supabase.from("imap_accounts").upsert(
      {
        user_id: user.id,
        host,
        port,
        username,
        password_encrypted: password,
        use_tls,
        mailbox,
        unread_only,
        mark_read,
        label,
        status: "Ready",
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,host,username" },
    );

    if (dbError) {
      // If upsert fails (e.g. no unique constraint yet), fall back to insert
      const { error: insertError } = await supabase.from("imap_accounts").insert({
        user_id: user.id,
        host,
        port,
        username,
        password_encrypted: password,
        use_tls,
        mailbox,
        unread_only,
        mark_read,
        label,
        status: "Ready",
        is_active: true,
      });
      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "Failed to save IMAP account" }, { status: 500 });
  }
}
