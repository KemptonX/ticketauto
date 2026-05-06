import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { sendEmailViaAccount } from "@/src/lib/send-email";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { to, accountId, subject, body } = (await request.json()) as {
      to: string;
      accountId: string;
      subject: string;
      body: string;
    };

    if (!to || !accountId || !subject?.trim() || !body?.trim()) {
      return NextResponse.json({ error: "to, accountId, subject, and body are required" }, { status: 400 });
    }

    const { data: account, error: accountError } = await supabase
      .from("gmail_accounts")
      .select("id, email, access_token, refresh_token, token_expiry, provider")
      .eq("id", accountId)
      .eq("is_active", true)
      .maybeSingle();

    if (accountError || !account) {
      return NextResponse.json({ error: "Selected inbox not found or inactive" }, { status: 400 });
    }

    await sendEmailViaAccount({
      supabase,
      account,
      to,
      subject: subject.trim(),
      body: body.trim(),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send email";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
