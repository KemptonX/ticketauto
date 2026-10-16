import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickActiveMembership, resolveGraceDecision, OUTAGE_GRACE_HOURS, type WhopMembership } from "./whop-entitlement.ts";

describe("pickActiveMembership", () => {
  const allowed = new Set(["prod_abc"]);

  it("matches by Discord ID and an allowed, active status", () => {
    const memberships: WhopMembership[] = [{ id: "m1", product: "prod_abc", status: "active", discord: { id: "d1" } }];
    const found = pickActiveMembership(memberships, allowed, { discordId: "d1" });
    assert.strictEqual(found?.id, "m1");
  });

  it("does not match a membership belonging to a DIFFERENT Discord account, even if product/status match", () => {
    const memberships: WhopMembership[] = [{ id: "m1", product: "prod_abc", status: "active", discord: { id: "someone-else" } }];
    const found = pickActiveMembership(memberships, allowed, { discordId: "d1" });
    assert.strictEqual(found, undefined, "a membership for a different Discord account must never be treated as this user's own");
  });

  it("rejects a membership for the right user but the wrong product", () => {
    const memberships: WhopMembership[] = [{ id: "m1", product: "prod_other", status: "active", discord: { id: "d1" } }];
    const found = pickActiveMembership(memberships, allowed, { discordId: "d1" });
    assert.strictEqual(found, undefined);
  });

  it("rejects an inactive/cancelled status not in the allowed set", () => {
    const memberships: WhopMembership[] = [{ id: "m1", product: "prod_abc", status: "cancelled_and_expired", discord: { id: "d1" } }];
    const found = pickActiveMembership(memberships, allowed, { discordId: "d1" });
    assert.strictEqual(found, undefined);
  });

  it("falls back to email matching only when no discordId identity is given", () => {
    const memberships: WhopMembership[] = [{ id: "m1", product: "prod_abc", status: "active", email: "user@example.com" }];
    const found = pickActiveMembership(memberships, allowed, { email: "user@example.com" });
    assert.strictEqual(found?.id, "m1");
  });

  it("an empty allowedProductIds set means any product is accepted (matches the live callback's existing behaviour)", () => {
    const memberships: WhopMembership[] = [{ id: "m1", product: "prod_whatever", status: "active", discord: { id: "d1" } }];
    const found = pickActiveMembership(memberships, new Set(), { discordId: "d1" });
    assert.strictEqual(found?.id, "m1");
  });
});

describe("resolveGraceDecision — Whop outage policy", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");

  it("first-ever failure (no existing row): preserves default-allow access and starts a fresh grace window", () => {
    const decision = resolveGraceDecision(null, now);
    assert.strictEqual(decision.isEntitled, true, "a never-checked user must not be locked out by the FIRST failed check");
    assert.ok(decision.graceUntil, "a grace window must be started");
    const graceDurationHours = (new Date(decision.graceUntil!).getTime() - now) / (1000 * 60 * 60);
    assert.strictEqual(graceDurationHours, OUTAGE_GRACE_HOURS);
  });

  it("a previously-entitled user stays entitled while a failure's grace window hasn't expired yet", () => {
    const stillInGrace = new Date(now + 1000 * 60 * 60).toISOString(); // 1h from now
    const decision = resolveGraceDecision({ is_entitled: true, grace_until: stillInGrace }, now);
    assert.strictEqual(decision.isEntitled, true, "a brief Whop outage must not immediately lock out a legitimate paying customer");
    assert.strictEqual(decision.graceUntil, stillInGrace, "the original grace deadline is preserved, not extended indefinitely by repeated failures");
  });

  it("access is revoked once the grace window has fully elapsed with no successful check in between", () => {
    const expiredGrace = new Date(now - 1000 * 60 * 60).toISOString(); // 1h ago
    const decision = resolveGraceDecision({ is_entitled: true, grace_until: expiredGrace }, now);
    assert.strictEqual(decision.isEntitled, false, "access must actually lapse eventually if Whop stays unreachable past the full grace window — this is a bounded policy, not indefinite trust");
    assert.strictEqual(decision.graceUntil, null, "grace window is cleared once consumed");
  });

  it("a previously NOT-entitled user (genuinely cancelled) stays not-entitled through an outage — an outage must never accidentally RESTORE access", () => {
    const decision = resolveGraceDecision({ is_entitled: false, grace_until: null }, now);
    assert.strictEqual(decision.isEntitled, false, "an outage during a failed check must never upgrade a cancelled user back to entitled");
  });
});
