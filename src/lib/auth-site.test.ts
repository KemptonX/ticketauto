import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { resolveAuthSite, PRODUCTION_AUTH_SITE } from "./auth-site.ts";

describe("resolveAuthSite — production must be unchanged", () => {
  for (const host of ["tixtracker.app", "www.tixtracker.app", "WWW.TixTracker.app"]) {
    test(`${host} in production -> hardcoded production values`, () => {
      assert.deepEqual(resolveAuthSite(host, "production"), PRODUCTION_AUTH_SITE);
    });
    test(`${host} even if VERCEL_ENV says preview -> production values`, () => {
      assert.deepEqual(resolveAuthSite(host, "preview"), PRODUCTION_AUTH_SITE);
    });
  }

  test("production deployment on a vercel.app alias keeps production values", () => {
    assert.deepEqual(resolveAuthSite("ticketauto-psi.vercel.app", "production"), PRODUCTION_AUTH_SITE);
  });

  test("missing host or env -> production values", () => {
    assert.deepEqual(resolveAuthSite(null, undefined), PRODUCTION_AUTH_SITE);
    assert.deepEqual(resolveAuthSite("ticketauto-abc-team.vercel.app", undefined), PRODUCTION_AUTH_SITE);
  });

  test("lookalike / unexpected hosts never get a custom origin", () => {
    for (const host of ["tixtracker.app.evil.com", "evil.com", "localhost:3000", "a.vercel.app:443", "x.vercel.app.evil.com"]) {
      assert.deepEqual(resolveAuthSite(host, "preview"), PRODUCTION_AUTH_SITE, host);
    }
  });
});

describe("resolveAuthSite — Vercel preview", () => {
  test("preview deployment uses its own origin with host-only cookies", () => {
    const host = "ticketauto-git-fix-prod-auth-security-io-kemptonxs-projects.vercel.app";
    assert.deepEqual(resolveAuthSite(host, "preview"), {
      origin: `https://${host}`,
      appOrigin: `https://${host}`,
      cookieDomain: undefined,
    });
  });
});
