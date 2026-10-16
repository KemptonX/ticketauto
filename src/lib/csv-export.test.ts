import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCsv } from "./csv-export.ts";

describe("CSV formula injection guard", () => {
  it("a cell starting with = is prefixed to neutralise it as a formula", () => {
    const csv = buildCsv(["Event"], [["=2+2"]]);
    assert.strictEqual(csv, "Event\n'=2+2", "a leading apostrophe forces spreadsheet apps to treat this as text, not a formula");
  });

  it("a cell starting with +, - (non-numeric), or @ is also guarded", () => {
    assert.strictEqual(buildCsv(["X"], [["+1+1"]]), "X\n'+1+1");
    assert.strictEqual(buildCsv(["X"], [["-cmd|' /C calc'!A1"]]), "X\n'-cmd|' /C calc'!A1", "a dangerous -cmd(...) payload is not a plain negative number and must still be guarded with a leading apostrophe");
    assert.strictEqual(buildCsv(["X"], [["@SUM(1,1)"]]), "X\n\"'@SUM(1,1)\"", "this payload also contains a comma, so it's additionally CSV-quoted as normal, on top of the formula guard");
  });

  it("a genuine negative financial amount is preserved as a real number, not mangled", () => {
    assert.strictEqual(buildCsv(["Profit"], [[-42.5]]), "Profit\n-42.5");
    assert.strictEqual(buildCsv(["Profit"], [["-42.50"]]), "Profit\n-42.50", "a negative amount passed as a string must also be recognised as numeric, not formula-guarded");
  });

  it("standard CSV escaping (commas, quotes, newlines) is unaffected by the formula guard", () => {
    assert.strictEqual(buildCsv(["Name"], [["Smith, John"]]), 'Name\n"Smith, John"');
    assert.strictEqual(buildCsv(["Name"], [['Say "hi"']]), 'Name\n"Say ""hi"""');
  });

  it("null/undefined cells become an empty string, never 'null' or 'undefined' text", () => {
    assert.strictEqual(buildCsv(["X"], [[null]]), "X\n");
    assert.strictEqual(buildCsv(["X"], [[undefined]]), "X\n");
  });

  it("an ordinary event/venue name with no special characters passes through unchanged", () => {
    assert.strictEqual(buildCsv(["Event", "Venue"], [["Coldplay", "Wembley Stadium"]]), "Event,Venue\nColdplay,Wembley Stadium");
  });
});
