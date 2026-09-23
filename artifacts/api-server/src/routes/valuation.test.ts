import assert from "node:assert/strict";
import test from "node:test";
import {
  selectValuePicks,
  valueForMoneyScore,
  type ValuePickCandidate,
} from "../lib/valuation-selection.ts";

function candidate(
  ticker: string,
  opportunityScore: number,
  overrides: Partial<ValuePickCandidate> = {},
): ValuePickCandidate {
  return {
    ticker,
    latestEps: 1,
    trailingPe: 10,
    peMedian: 20,
    opportunityScore,
    ...overrides,
  };
}

test("selects at most five complete positive-EPS candidates", () => {
  const assessments = [
    candidate("0001.HK", 80),
    candidate("0002.HK", 90),
    candidate("0003.HK", 70),
    candidate("0005.HK", 60),
    candidate("0006.HK", 50),
    candidate("0012.HK", 40),
    candidate("0700.HK", 999, { latestEps: -3.92 }),
    candidate("3690.HK", 998, { trailingPe: null }),
    candidate("9988.HK", 997, { peMedian: null }),
  ];

  assert.deepEqual(
    selectValuePicks(assessments).map((item) => item.ticker),
    ["0002.HK", "0001.HK", "0003.HK", "0005.HK", "0006.HK"],
  );
});

test("rejects a universe with fewer than five complete positive-EPS candidates", () => {
  assert.throws(
    () => selectValuePicks([
      candidate("0001.HK", 80),
      candidate("0002.HK", 70),
      candidate("0003.HK", 60),
      candidate("0005.HK", 50),
      candidate("0700.HK", 999, { latestEps: -1 }),
    ]),
    /fewer than five|Only 4 candidates have complete positive-EPS valuation data/i,
  );
});

test("uses growth and valuation discount components with the documented caps", () => {
  assert.equal(valueForMoneyScore(0.5, 0.5, 0.5, 0.3), 100);
  assert.equal(valueForMoneyScore(null, 0.5, 0.5, 0.3), 55);
  assert.equal(valueForMoneyScore(0.15, -0.2, 0, null), 28);
});

test("uses ticker order as a stable tie-breaker", () => {
  const picks = selectValuePicks([
    candidate("0006.HK", 80),
    candidate("0001.HK", 80),
    candidate("0005.HK", 80),
    candidate("0003.HK", 80),
    candidate("0002.HK", 80),
  ]);

  assert.deepEqual(
    picks.map((item) => item.ticker),
    ["0001.HK", "0002.HK", "0003.HK", "0005.HK", "0006.HK"],
  );
});