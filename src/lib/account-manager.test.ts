import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyPlatform, buildDiscoveryCandidates } from "./account-manager.ts";

describe("classifyPlatform", () => {
  it("recognises every real Ticketmaster source_type variant seen in production", () => {
    for (const s of ["ticketmaster_direct", "ticketmaster_resale", "Ticketmaster UK", "Ticketmaster US", "Ticketmaster", "ticketmaster_de"]) {
      assert.equal(classifyPlatform(s), "ticketmaster", s);
    }
  });

  it("recognises every real AXS source_type variant seen in production", () => {
    for (const s of ["AXS", "axs", "Axs", "axs_us"]) {
      assert.equal(classifyPlatform(s), "axs", s);
    }
  });

  it("classifies unrelated platforms as other", () => {
    for (const s of ["Viagogo", "see_tickets_uk", "manual", "tixr", null, undefined]) {
      assert.equal(classifyPlatform(s), "other", String(s));
    }
  });
});

describe("buildDiscoveryCandidates", () => {
  const orders = [
    { account_email: "a@gmail.com", source_type: "ticketmaster_direct", created_at: "2026-01-01" },
    { account_email: "a@gmail.com", source_type: "ticketmaster_resale", created_at: "2026-02-01" },
    { account_email: "b@gmail.com", source_type: "AXS", created_at: "2026-01-15" },
    { account_email: "c@gmail.com", source_type: "Viagogo", created_at: "2026-01-15" }, // not TM/AXS — excluded
    { account_email: null, source_type: "ticketmaster_direct", created_at: "2026-01-15" }, // no email — excluded
  ];

  it("groups by platform+email, counts orders, and tracks the most recent date", () => {
    const result = buildDiscoveryCandidates(orders, new Set());
    const a = result.find((r) => r.email === "a@gmail.com");
    assert.ok(a);
    assert.equal(a!.platform, "ticketmaster");
    assert.equal(a!.orderCount, 2);
    assert.equal(a!.lastSeenAt, "2026-02-01");
  });

  it("only surfaces Ticketmaster/AXS — never other platforms, per the brief", () => {
    const result = buildDiscoveryCandidates(orders, new Set());
    assert.equal(result.some((r) => r.email === "c@gmail.com"), false);
  });

  it("excludes an email already saved as an account on the same platform (case-insensitive)", () => {
    const result = buildDiscoveryCandidates(orders, new Set(["ticketmaster__a@gmail.com"]));
    assert.equal(result.some((r) => r.email === "a@gmail.com"), false);
    assert.equal(result.some((r) => r.email === "b@gmail.com"), true);
  });

  it("still surfaces the same email on a different platform — saving one does not suppress the other", () => {
    const result = buildDiscoveryCandidates(orders, new Set(["axs__a@gmail.com"]));
    assert.equal(result.some((r) => r.email === "a@gmail.com" && r.platform === "ticketmaster"), true);
  });

  it("never produces a candidate for a row with no account_email", () => {
    const result = buildDiscoveryCandidates(orders, new Set());
    assert.equal(result.some((r) => !r.email), false);
  });
});
