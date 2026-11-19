import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isNoopCursorUpdate } from "./sms-poll-state.ts";

const base = {
  lastSeenAt: "2026-10-10T15:13:16+00:00",
  signatures: ["a|b|hello|2026-10-10T15:13:16.000Z"],
  error: null,
};

describe("isNoopCursorUpdate — SMS poller redundant-write skip", () => {
  test("idle cycle with identical state is a no-op (write skipped)", () => {
    assert.equal(
      isNoopCursorUpdate({ isFirstPoll: false, newMessageCount: 0, previous: base, next: { ...base } }),
      true,
    );
  });

  test("'+00:00' vs 'Z' for the same instant counts as unchanged", () => {
    assert.equal(
      isNoopCursorUpdate({
        isFirstPoll: false,
        newMessageCount: 0,
        previous: base,
        next: { ...base, lastSeenAt: "2026-10-10T15:13:16.000Z" },
      }),
      true,
    );
  });

  test("null and empty signature lists are equivalent", () => {
    assert.equal(
      isNoopCursorUpdate({
        isFirstPoll: false,
        newMessageCount: 0,
        previous: { ...base, signatures: null },
        next: { ...base, signatures: [] },
      }),
      true,
    );
  });

  test("first poll always writes", () => {
    assert.equal(isNoopCursorUpdate({ isFirstPoll: true, newMessageCount: 0, previous: base, next: base }), false);
  });

  test("any new message always writes", () => {
    assert.equal(isNoopCursorUpdate({ isFirstPoll: false, newMessageCount: 1, previous: base, next: base }), false);
  });

  test("cursor moving forward writes", () => {
    assert.equal(
      isNoopCursorUpdate({
        isFirstPoll: false,
        newMessageCount: 0,
        previous: base,
        next: { ...base, lastSeenAt: "2026-10-10T15:13:17Z" },
      }),
      false,
    );
  });

  test("signatures being cleared writes (preserves previous behaviour)", () => {
    assert.equal(
      isNoopCursorUpdate({ isFirstPoll: false, newMessageCount: 0, previous: base, next: { ...base, signatures: [] } }),
      false,
    );
  });

  test("a new error writes, and clearing a previous error writes", () => {
    assert.equal(
      isNoopCursorUpdate({ isFirstPoll: false, newMessageCount: 0, previous: base, next: { ...base, error: "Discord 404" } }),
      false,
    );
    assert.equal(
      isNoopCursorUpdate({ isFirstPoll: false, newMessageCount: 0, previous: { ...base, error: "HTTP 500" }, next: base }),
      false,
    );
  });
});
