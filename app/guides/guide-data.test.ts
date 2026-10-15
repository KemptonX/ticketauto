// Structural validation for the guide content — catches the two ways this
// file tends to rot over time: a relatedIds reference to an article that
// got renamed/removed, and an appLink pointing at a route that no longer
// exists. Deliberately lightweight (no markdown/MDX pipeline, no build
// step) — just plain assertions against the data + filesystem, run by the
// same `npm test` as everything else in src/lib.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ARTICLES, CATEGORIES } from "./guide-data.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, ".."); // app/guides/.. -> app/

// Resolves an in-app href like "/settings" or "/" to the Next.js route
// directory that must exist for it to actually work.
function routeExists(href: string): boolean {
  const path = href.split("?")[0].split("#")[0];
  const segments = path === "/" ? [] : path.replace(/^\//, "").split("/");
  const routeDir = join(APP_DIR, ...segments);
  return (
    existsSync(join(routeDir, "page.tsx")) ||
    existsSync(join(routeDir, "page.ts"))
  );
}

describe("Guide content structure", () => {
  it("every article has a non-empty title, summary and at least one of each core section", () => {
    for (const a of ARTICLES) {
      assert.ok(a.title.trim().length > 0, `${a.id}: empty title`);
      assert.ok(a.summary.trim().length > 0, `${a.id}: empty summary`);
      assert.ok(a.whatIsIt.length > 0, `${a.id}: missing "what is it"`);
      assert.ok(a.howToUseIt.length > 0, `${a.id}: missing "how to use it"`);
    }
  });

  it("no duplicate article ids", () => {
    const ids = ARTICLES.map((a) => a.id);
    const unique = new Set(ids);
    assert.strictEqual(ids.length, unique.size, "duplicate article id found");
  });

  it("no duplicate category ids", () => {
    const ids = CATEGORIES.map((c) => c.id);
    const unique = new Set(ids);
    assert.strictEqual(ids.length, unique.size, "duplicate category id found");
  });

  it("every article's categoryId refers to a real category", () => {
    const categoryIds = new Set(CATEGORIES.map((c) => c.id));
    for (const a of ARTICLES) {
      assert.ok(categoryIds.has(a.categoryId), `${a.id}: unknown categoryId "${a.categoryId}"`);
    }
  });

  it("every relatedIds entry points to a real, different article", () => {
    const articleIds = new Set(ARTICLES.map((a) => a.id));
    for (const a of ARTICLES) {
      for (const rel of a.relatedIds ?? []) {
        assert.ok(articleIds.has(rel), `${a.id}: relatedIds references unknown article "${rel}"`);
        assert.notStrictEqual(rel, a.id, `${a.id}: relatedIds references itself`);
      }
    }
  });

  it("every category has at least one article", () => {
    const used = new Set(ARTICLES.map((a) => a.categoryId));
    for (const c of CATEGORIES) {
      assert.ok(used.has(c.id), `category "${c.id}" has no articles — dead category`);
    }
  });

  it("every appLink points to a route that genuinely exists in app/", () => {
    for (const a of ARTICLES) {
      if (!a.appLink) continue;
      assert.ok(
        routeExists(a.appLink.href),
        `${a.id}: appLink "${a.appLink.href}" does not resolve to a real page.tsx under app/`,
      );
    }
  });

  it("importantNotes only use recognised note types", () => {
    const validTypes = new Set(["tip", "warning", "beta"]);
    for (const a of ARTICLES) {
      for (const note of a.importantNotes) {
        assert.ok(validTypes.has(note.type), `${a.id}: unknown note type "${note.type}"`);
        assert.ok(note.text.trim().length > 0, `${a.id}: empty note text`);
      }
    }
  });
});
