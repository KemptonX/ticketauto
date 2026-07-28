import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import type { PreviewRow } from "@/app/presale/import-utils";

export const runtime = "nodejs";

type ConfirmBody = {
  rows: PreviewRow[];
  method: string;
  fileName?: string;
};

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { rows, method, fileName } = await request.json() as ConfirmBody;

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "No rows to import" }, { status: 400 });
  }

  // Create import batch record
  let batchId = "";
  try {
    const { data: batch } = await supabase
      .from("import_batches")
      .insert({ user_id: user.id, method, file_names: fileName ? [fileName] : [], total_rows: rows.length })
      .select("id")
      .single() as { data: { id: string } | null };
    batchId = batch?.id ?? "";
  } catch {
    // import_batches table may not exist yet — import still proceeds without batch tracking
  }

  let imported = 0, skipped = 0, failed = 0;
  const errors: string[] = [];

  for (const row of rows) {
    if (row._status === "invalid") { skipped++; continue; }
    if (!row.account_email) { skipped++; continue; }

    const insertData: Record<string, unknown> = {
      user_id:      user.id,
      campaign:     row.campaign || "la28_olympics",
      account_email: row.account_email,
      presale_code:  row.presale_code,
      slot_start:    row.slot_start,
      slot_end:      row.slot_end,
      notes:         row.notes,
      source_message_id: null,
    };
    if (batchId) insertData.import_batch_id = batchId;

    const { error } = await supabase.from("presale_entries").insert(insertData);

    if (error) {
      if (error.code === "23505") {
        // unique constraint — already exists
        skipped++;
      } else if (error.message.includes("import_batch_id")) {
        // Column doesn't exist yet (migration not run) — retry without it
        const { error: err2 } = await supabase.from("presale_entries").insert({
          ...insertData, import_batch_id: undefined,
        });
        err2 ? (failed++, errors.length < 10 && errors.push(`Row ${row._index + 1}: ${err2.message}`)) : imported++;
      } else {
        failed++;
        if (errors.length < 10) errors.push(`Row ${row._index + 1}: ${error.message}`);
      }
    } else {
      imported++;
    }
  }

  // Update batch stats
  if (batchId) {
    try {
      await supabase.from("import_batches").update({
        imported, skipped, failed,
        status: failed > 0 ? (imported > 0 ? "partial" : "failed") : "completed",
      }).eq("id", batchId);
    } catch {}
  }

  return NextResponse.json({ imported, skipped, failed, batchId, errors });
}
