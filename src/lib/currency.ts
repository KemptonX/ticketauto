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

export function formatCurrency(value: number | null | undefined, currencyCode?: string): string {
  if (value == null) return "—";
  const code = currencyCode ?? getCurrencyCode();
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)}`;
  }
}
