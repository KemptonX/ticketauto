const STORAGE_KEY = "ticketauto_currency";

export const CURRENCY_OPTIONS = [
  { code: "GBP", label: "GBP — British Pound (£)" },
  { code: "USD", label: "USD — US Dollar ($)" },
  { code: "EUR", label: "EUR — Euro (€)" },
  { code: "AUD", label: "AUD — Australian Dollar (A$)" },
  { code: "CAD", label: "CAD — Canadian Dollar (C$)" },
  { code: "NZD", label: "NZD — New Zealand Dollar (NZ$)" },
  { code: "CHF", label: "CHF — Swiss Franc" },
  { code: "SEK", label: "SEK — Swedish Krona (kr)" },
  { code: "NOK", label: "NOK — Norwegian Krone (kr)" },
  { code: "DKK", label: "DKK — Danish Krone (kr)" },
  { code: "JPY", label: "JPY — Japanese Yen (¥)" },
  { code: "SGD", label: "SGD — Singapore Dollar (S$)" },
  { code: "HKD", label: "HKD — Hong Kong Dollar (HK$)" },
  { code: "AED", label: "AED — UAE Dirham (د.إ)" },
];

export function getCurrencyCode(): string {
  if (typeof window === "undefined") return "GBP";
  return localStorage.getItem(STORAGE_KEY) ?? "GBP";
}

export function setCurrencyCode(code: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, code);
}

// ── Client-side rate cache ────────────────────────────────────────────────────
// Rates are GBP → target (e.g. rates["USD"] = 1.27 means £1 = $1.27).
// initCurrencyRates() is called once by CurrencyProvider on app boot.
// formatCurrency() uses these to convert stored GBP values for display.

let _clientRates: Record<string, number> | null = null;
let _initPromise: Promise<void> | null = null;

export async function initCurrencyRates(): Promise<void> {
  if (_clientRates !== null) return;
  if (_initPromise) return _initPromise;
  _initPromise = fetch("/api/rates")
    .then(r => r.json() as Promise<{ rates?: Record<string, number> }>)
    .then(d => { if (d.rates) _clientRates = d.rates; })
    .catch(() => {})
    .finally(() => { _initPromise = null; });
  return _initPromise;
}

// Returns the current cached rates (null if not yet loaded).
export function getClientRates(): Record<string, number> | null {
  return _clientRates;
}

// Converts a GBP value to the target currency using cached rates.
// Falls back to 1:1 (no conversion) when rates aren't loaded yet.
export function convertFromGbp(gbpValue: number, targetCurrency: string): number {
  if (targetCurrency === "GBP" || !_clientRates) return gbpValue;
  const rate = _clientRates[targetCurrency];
  if (!rate) return gbpValue;
  return Math.round(gbpValue * rate * 100) / 100;
}

// Converts a value entered in the user's selected currency to GBP for storage.
export function convertToGbpClient(userValue: number, fromCurrency: string): number {
  if (fromCurrency === "GBP" || !_clientRates) return userValue;
  const rate = _clientRates[fromCurrency];
  if (!rate) return userValue;
  return Math.round((userValue / rate) * 100) / 100;
}

export function formatCurrency(value: number | null | undefined, currencyCode?: string): string {
  if (value == null) return "—";
  const code = currencyCode ?? getCurrencyCode();
  const displayValue = code === "GBP" ? value : convertFromGbp(value, code);
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(displayValue);
  } catch {
    return `${displayValue.toFixed(2)}`;
  }
}
