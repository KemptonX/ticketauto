import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHeader,
  autoMapHeader,
  parseImportNumber,
  detectCurrencySymbol,
  parseImportDate,
  parseCSV,
} from "./spreadsheet-parsing.ts";

describe("normalizeHeader", () => {
  it("lowercases, trims, and collapses separators", () => {
    assert.equal(normalizeHeader("  Event_Name  "), "event name");
    assert.equal(normalizeHeader("Qty-Bought"), "qty bought");
    assert.equal(normalizeHeader("Sold   For"), "sold for");
  });
});

describe("autoMapHeader", () => {
  const fields = [
    { key: "event_name", aliases: ["artist", "show", "event"] },
    { key: "venue", aliases: ["arena", "stadium"] },
    { key: "qty_bought", aliases: ["qty", "quantity"] },
  ];

  it("matches by exact key", () => {
    assert.equal(autoMapHeader("Event Name", fields), "event_name");
  });

  it("matches the brief's worked examples (Artist/Arena/QTY)", () => {
    assert.equal(autoMapHeader("Artist", fields), "event_name");
    assert.equal(autoMapHeader("Arena", fields), "venue");
    assert.equal(autoMapHeader("QTY", fields), "qty_bought");
  });

  it("falls back to the longest substring alias match", () => {
    const withLonger = [
      ...fields,
      { key: "qty_sold", aliases: ["qty sold"] },
    ];
    assert.equal(autoMapHeader("Total Qty Sold Today", withLonger), "qty_sold");
  });

  it("returns skip when nothing matches", () => {
    assert.equal(autoMapHeader("Completely Unrelated Column", fields), "skip");
  });
});

describe("parseImportNumber", () => {
  it("strips currency symbols and commas", () => {
    assert.equal(parseImportNumber("£1,250.50"), 1250.5);
    assert.equal(parseImportNumber("$99.99"), 99.99);
    assert.equal(parseImportNumber("€40"), 40);
  });

  it("returns null (not 0) for blank/placeholder cells", () => {
    assert.equal(parseImportNumber(""), null);
    assert.equal(parseImportNumber("   "), null);
    assert.equal(parseImportNumber("-"), null);
    assert.equal(parseImportNumber("N/A"), null);
  });

  it("preserves negative values", () => {
    assert.equal(parseImportNumber("-45.00"), -45);
  });

  it("returns null for genuinely unparseable text", () => {
    assert.equal(parseImportNumber("abc"), null);
  });
});

describe("detectCurrencySymbol", () => {
  it("detects £, $, €", () => {
    assert.equal(detectCurrencySymbol("£100"), "GBP");
    assert.equal(detectCurrencySymbol("$100"), "USD");
    assert.equal(detectCurrencySymbol("€100"), "EUR");
  });
  it("returns null when no symbol is present", () => {
    assert.equal(detectCurrencySymbol("100"), null);
  });
});

describe("parseImportDate", () => {
  it("parses ISO dates", () => {
    assert.equal(parseImportDate("2025-06-15"), "2025-06-15");
    assert.equal(parseImportDate("2025-06-15T10:00:00Z"), "2025-06-15");
  });

  it("parses UK-style DD/MM/YYYY", () => {
    assert.equal(parseImportDate("15/06/2025"), "2025-06-15");
  });

  it("parses textual dates (day-first and month-first)", () => {
    assert.equal(parseImportDate("15 June 2025"), "2025-06-15");
    assert.equal(parseImportDate("June 15, 2025"), "2025-06-15");
  });

  it("returns null for blank input", () => {
    assert.equal(parseImportDate(""), null);
    assert.equal(parseImportDate("   "), null);
  });

  it("returns null (not the raw string) for genuinely unparseable text — the bug this module fixes", () => {
    assert.equal(parseImportDate("whenever, probably"), null);
    assert.equal(parseImportDate("TBC"), null);
  });
});

describe("parseCSV", () => {
  it("parses a simple comma-separated file", () => {
    const rows = parseCSV("a,b,c\n1,2,3");
    assert.deepEqual(rows, [["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("handles quoted cells containing commas", () => {
    const rows = parseCSV('name,note\n"Smith, John","Hello, ""World"""');
    assert.deepEqual(rows, [["name", "note"], ["Smith, John", 'Hello, "World"']]);
  });

  it("handles tab-separated input", () => {
    const rows = parseCSV("a\tb\n1\t2");
    assert.deepEqual(rows, [["a", "b"], ["1", "2"]]);
  });

  it("skips fully blank rows", () => {
    const rows = parseCSV("a,b\n1,2\n,\n3,4");
    assert.deepEqual(rows, [["a", "b"], ["1", "2"], ["3", "4"]]);
  });
});
