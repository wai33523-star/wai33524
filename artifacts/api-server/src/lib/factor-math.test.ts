import assert from "node:assert/strict";
import test from "node:test";
import { rollingZScore } from "./factor-math.ts";

test("rolling Z-score matches pandas sample standard deviation", () => {
  const result = rollingZScore([1, 2, 3], 3);
  assert.deepEqual(result.slice(0, 2), [null, null]);
  assert.equal(result[2], 1);
});

test("rolling Z-score resets its window after missing data", () => {
  const result = rollingZScore([1, 2, 3, null, 4, 5, 6], 3);
  assert.equal(result[2], 1);
  assert.equal(result[3], null);
  assert.equal(result[4], null);
  assert.equal(result[5], null);
  assert.equal(result[6], 1);
});

test("constant windows produce a finite zero score", () => {
  assert.deepEqual(rollingZScore([5, 5, 5], 3), [null, null, 0]);
});