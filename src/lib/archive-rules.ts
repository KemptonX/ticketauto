import type { SupabaseClient } from "@supabase/supabase-js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

type ArchiveRow = {
  id: number;
  event_date: string | null;
};

export async function autoArchiveExpiredOrders({
  supabase,
  userId,
}: {
  supabase: SupabaseClient;
  userId: string;
}) {
  const { error: soldRestoreError } = await supabase
    .from("orders")
    .update({ listing_status: "Sold" })
    .eq("user_id", userId)
    .eq("listing_status", "Archived")
    .gt("sold_total", 0);

  if (soldRestoreError) {
    throw new Error(soldRestoreError.message);
  }

  const { error: restoreError } = await supabase
    .from("orders")
    .update({ listing_status: "Unlisted" })
    .eq("user_id", userId)
    .eq("listing_status", "Archived")
    .or("sold_total.is.null,sold_total.eq.0");

  if (restoreError) {
    throw new Error(restoreError.message);
  }

  return 0;
}

export async function autoArchiveExpiredSales({
  supabase,
  userId,
}: {
  supabase: SupabaseClient;
  userId: string;
}) {
  const { data, error } = await supabase
    .from("sales")
    .select("id, event_date")
    .eq("user_id", userId)
    .neq("sale_status", "Archived");

  if (error) {
    throw new Error(error.message);
  }

  const expiredIds = getExpiredIds((data as ArchiveRow[] | null) ?? []);
  if (expiredIds.length === 0) {
    return 0;
  }

  const { error: updateError } = await supabase
    .from("sales")
    .update({ sale_status: "Archived" })
    .in("id", expiredIds);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return expiredIds.length;
}

function getExpiredIds(rows: ArchiveRow[]) {
  const cutoff = new Date(Date.now() - DAY_IN_MS);

  return rows
    .filter((row) => {
      const eventDate = parseArchiveDate(row.event_date);
      return eventDate != null && eventDate.getTime() < cutoff.getTime();
    })
    .map((row) => row.id);
}

function parseArchiveDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const cleaned = value
    .replace(/\|/g, " ")
    .replace(/•/g, " ")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const direct = new Date(cleaned);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const match = cleaned.match(
    /\b([A-Z][a-z]+)\s+(\d{1,2})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/,
  );

  if (!match) {
    return null;
  }

  const [, monthName, day, year, hour = "0", minute = "0"] = match;
  const monthIndex = monthNames.indexOf(monthName.toLowerCase());
  if (monthIndex === -1) {
    return null;
  }

  return new Date(
    Number(year),
    monthIndex,
    Number(day),
    Number(hour),
    Number(minute),
  );
}

const monthNames = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
