// Server-only exchange rate utilities.
// Used by gmail-sync.ts (import side) and /api/rates (display side).

let _rateCache: { rates: Record<string, number>; fetchedAt: number } | null = null;

export async function getGbpRates(): Promise<Record<string, number>> {
  const now = Date.now();
  if (_rateCache && now - _rateCache.fetchedAt < 3_600_000) return _rateCache.rates;

  let rates: Record<string, number> = {};

  // Primary: frankfurter.app (ECB-tracked currencies — covers most but not AED)
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=GBP", { cache: "no-store" });
    const data = (await res.json()) as { rates?: Record<string, number> };
    if (data.rates) rates = { ...data.rates };
  } catch { /* fall through to supplemental */ }

  // Supplemental: covers AED and 170+ other currencies not on ECB
  if (!rates["AED"]) {
    try {
      const res = await fetch(
        "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/gbp.json",
        { cache: "no-store" }
      );
      const data = (await res.json()) as { gbp?: Record<string, number> };
      if (data.gbp) {
        for (const [k, v] of Object.entries(data.gbp)) {
          const upper = k.toUpperCase();
          if (!rates[upper]) rates[upper] = v as number;
        }
      }
    } catch { /* fall through */ }
  }

  if (Object.keys(rates).length > 0) {
    _rateCache = { rates, fetchedAt: now };
  }
  return rates;
}

// Converts a raw amount string from the given currency into GBP.
// Returns the original string on failure so callers can still store something.
export async function convertToGbp(rawAmount: string, currency: string): Promise<string> {
  if (!rawAmount) return "";
  const num = parseFloat(rawAmount);
  if (isNaN(num) || num <= 0) return "";
  if (currency === "GBP") return rawAmount;
  const rates = await getGbpRates();
  const rate = rates[currency];
  if (!rate) return rawAmount;
  return String(Math.round((num / rate) * 100) / 100);
}
