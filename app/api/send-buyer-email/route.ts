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

    const { saleId, accountId, subject, body } = (await request.json()) as {
      saleId: number;
      accountId: string;
      subject: string;
      body: string;
    };

    if (!saleId || !accountId || !subject?.trim() || !body?.trim()) {
      return NextResponse.json({ error: "saleId, accountId, subject, and body are required" }, { status: 400 });
    }

    const { data: sale, error: saleError } = await supabase
      .from("sales")
      .select("id, buyer_email")
      .eq("id", saleId)
      .single();

    if (saleError || !sale) {
      return NextResponse.json({ error: "Sale not found" }, { status: 404 });
    }

    if (!sale.buyer_email) {
      return NextResponse.json({ error: "No buyer email on this sale" }, { status: 400 });
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
      to: sale.buyer_email,
      subject: subject.trim(),
      body: body.trim(),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send email";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
