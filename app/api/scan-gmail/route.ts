import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "You must be signed in" }, { status: 401 });
    }

    const { data: gmailAccount, error: accountError } = await supabase
      .from("gmail_accounts")
      .select("email, access_token, refresh_token, token_expiry, is_primary, is_active, status")
      .eq("is_active", true)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (accountError) {
      return NextResponse.json({ error: accountError.message }, { status: 500 });
    }

    if (!gmailAccount) {
      return NextResponse.json(
        { error: "Connect Gmail in Connections before running a scan" },
        { status: 400 },
      );
    }

    if (!gmailAccount.access_token) {
      return NextResponse.json(
        { error: `Gmail OAuth is incomplete for ${gmailAccount.email}` },
        { status: 400 },
      );
    }

    const scriptPath = "C:\\ticketmaster_bot\\gmail_to_excel.py";
    const workingDirectory = "C:\\ticketmaster_bot";
    const env = {
      ...process.env,
      TICKETAUTO_USER_ID: user.id,
      GMAIL_ACCESS_TOKEN: gmailAccount.access_token,
      GMAIL_REFRESH_TOKEN: gmailAccount.refresh_token || "",
      GMAIL_TOKEN_EXPIRY: gmailAccount.token_expiry || "",
    };

    let command = "python";
    let args = [scriptPath];

    try {
      await execFileAsync(command, args, {
        cwd: workingDirectory,
        timeout: 120000,
        env,
      });
    } catch {
      command = "py";
      args = [scriptPath];
      await execFileAsync(command, args, {
        cwd: workingDirectory,
        timeout: 120000,
        env,
      });
    }

    await supabase
      .from("gmail_accounts")
      .update({
        last_synced_at: new Date().toISOString(),
        status: "Ready",
      })
      .eq("email", gmailAccount.email);

    return NextResponse.json({ ok: true, email: gmailAccount.email });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scan error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
