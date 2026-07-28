import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { parseSpreadsheetBuffer, parsePastedText } from "@/src/lib/presale-import";
import { autoMatchColumns, transformRows } from "@/app/presale/import-utils";

export const runtime = "nodejs";

const ALLOWED_EXTENSIONS = new Set([
  "csv", "tsv", "txt", "xlsx", "xls", "xlsm", "xlsb", "ods", "json",
]);

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ct = request.headers.get("content-type") ?? "";

  let parsed: ReturnType<typeof parseSpreadsheetBuffer>;
  let fileName = "";

  if (ct.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 400 });
    }
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json({ error: `Unsupported file type: .${ext}. Supported: CSV, XLSX, XLS, ODS, TSV, JSON` }, { status: 400 });
    }

    fileName = file.name;
    const buffer = Buffer.from(await file.arrayBuffer());
    parsed = parseSpreadsheetBuffer(buffer, file.name);
  } else {
    const body = await request.json() as { text?: string };
    if (!body.text?.trim()) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }
    parsed = parsePastedText(body.text);
  }

  const { headers, rawRows, method, totalCount } = parsed;

  if (headers.length === 0) {
    return NextResponse.json({ error: "No columns detected — is the file empty?" }, { status: 400 });
  }

  const mapping = autoMatchColumns(headers);
  const rows = transformRows(rawRows, mapping);

  // Duplicate detection: load existing entry fingerprints for this user
  const { data: existing } = await supabase
    .from("presale_entries")
    .select("campaign, account_email, slot_start, presale_code")
    .eq("user_id", user.id) as {
      data: Array<{ campaign: string; account_email: string; slot_start: string | null; presale_code: string | null }> | null;
    };

  const fpSet = new Set<string>();
  for (const e of existing ?? []) {
    fpSet.add(`${e.campaign}|${e.account_email.toLowerCase()}|${e.slot_start ?? ""}|${e.presale_code ?? ""}`);
  }

  const batchFp = new Set<string>();
  const dedupedRows = rows.map(row => {
    if (row._status !== "ready") return row;
    const fp = `${row.campaign}|${row.account_email.toLowerCase()}|${row.slot_start ?? ""}|${row.presale_code ?? ""}`;
    if (fpSet.has(fp) || batchFp.has(fp)) return { ...row, _status: "duplicate" as const };
    batchFp.add(fp);
    return row;
  });

  const warnings: string[] = [];
  if (totalCount > rawRows.length) {
    warnings.push(`File has ${totalCount.toLocaleString()} rows — showing the first 5,000`);
  }

  return NextResponse.json({ headers, rawRows, rows: dedupedRows, mapping, method, fileName, warnings });
}
