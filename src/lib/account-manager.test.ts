import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyPlatform, buildDiscoveryCandidates, assessCandidateConfidence, matchesPlatform } from "./account-manager.ts";

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

  it("flags a real vendor/support address found in production as needing review, without filtering it out", () => {
    const vendorOrders = [
      { account_email: "customerservice@biggreencoach.co.uk", source_type: "ticketmaster_direct", created_at: "2026-06-22" },
      { account_email: "customerserviceteam@warnermusic.com", source_type: "ticketmaster_direct", created_at: "2026-04-21" },
      { account_email: "no-reply@ticketmaster.co.uk", source_type: "ticketmaster_resale", created_at: "2026-01-01" },
    ];
    const result = buildDiscoveryCandidates(vendorOrders, new Set());
    assert.equal(result.length, 3);
    assert.ok(result.every((r) => r.needsReview === true), "every known vendor/support address should be flagged");
    assert.ok(result.every((r) => typeof r.reviewReason === "string" && r.reviewReason.length > 0));
  });

  it("does not flag an ordinary personal email as needing review", () => {
    const result = buildDiscoveryCandidates(
      [{ account_email: "john.smith92@gmail.com", source_type: "AXS", created_at: "2026-01-01" }],
      new Set(),
    );
    assert.equal(result[0].needsReview, false);
    assert.equal(result[0].reviewReason, null);
  });
});

describe("matchesPlatform", () => {
  it("reproduces the real reported bug: a Ticketmaster and an AXS account sharing the same email must not both match the same order", () => {
    const tmOrder = { source_type: "ticketmaster_direct" };
    const axsOrder = { source_type: "AXS" };
    assert.equal(matchesPlatform("ticketmaster", tmOrder.source_type), true);
    assert.equal(matchesPlatform("axs", tmOrder.source_type), false);
    assert.equal(matchesPlatform("axs", axsOrder.source_type), true);
    assert.equal(matchesPlatform("ticketmaster", axsOrder.source_type), false);
  });

  it("handles every real source_type casing variant seen in production for both platforms", () => {
    for (const s of ["ticketmaster_direct", "Ticketmaster UK", "Ticketmaster"]) assert.equal(matchesPlatform("ticketmaster", s), true, s);
    for (const s of ["AXS", "axs", "Axs", "axs_us"]) assert.equal(matchesPlatform("axs", s), true, s);
  });

  it("an 'other' platform account only matches orders that aren't classified as Ticketmaster or AXS", () => {
    assert.equal(matchesPlatform("other", "Viagogo"), true);
    assert.equal(matchesPlatform("other", "ticketmaster_direct"), false);
  });
});

describe("assessCandidateConfidence", () => {
  it("flags known support/no-reply style local parts", () => {
    for (const email of ["customerservice@biggreencoach.co.uk", "customerserviceteam@warnermusic.com", "no-reply@ticketmaster.co.uk", "enquiries@someco.com"]) {
      assert.equal(assessCandidateConfidence(email).needsReview, true, email);
    }
  });

  it("does not flag a generic word that merely appears inside an otherwise personal address", () => {
    // "customer" / "service" / "info" / "team" alone are deliberately NOT
    // in the keyword list — too likely to false-positive on a genuine
    // personal address (e.g. a name that happens to contain one).
    for (const email of ["infoguy22@gmail.com", "team.rivera@gmail.com", "customer1999@hotmail.com"]) {
      assert.equal(assessCandidateConfidence(email).needsReview, false, email);
    }
  });
});
