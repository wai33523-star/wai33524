import assert from "node:assert/strict";
import test from "node:test";
import { calculateCostMetrics } from "./backtest-cost.ts";

const grossReturns = [0.02, 0.001, -0.003, 0];

test("zero cost preserves gross returns and gross hit rate", () => {
  const metrics = calculateCostMetrics(grossReturns, 0);

  assertClose(metrics.netAverageReturn, 0.0045);
  assert.equal(metrics.netHitRate, 0.5);
  assert.equal(metrics.netBestReturn, 0.02);
  assert.equal(metrics.netWorstReturn, -0.003);
});

test("baseline one-way costs are deducted as a round-trip amount", () => {
  const roundTripBps = 2 * (10 + 5);
  const metrics = calculateCostMetrics(grossReturns, roundTripBps);

  assert.equal(roundTripBps, 30);
  assertClose(metrics.netAverageReturn, 0.0015);
  assert.equal(metrics.netHitRate, 0.25);
  assertClose(metrics.netMedianReturn, -0.0025);
});

test("maximum supported one-way costs can turn every trade into a net loss", () => {
  const roundTripBps = 2 * (100 + 100);
  const metrics = calculateCostMetrics(grossReturns, roundTripBps);

  assert.equal(roundTripBps, 400);
  assertClose(metrics.netAverageReturn, -0.0355);
  assert.equal(metrics.netHitRate, 0);
  assertClose(metrics.netBestReturn, -0.02);
  assertClose(metrics.netWorstReturn, -0.043);
});

test("net hit rate is calculated from net returns, not copied from gross hit rate", () => {
  const metrics = calculateCostMetrics([0.0005, 0.01], 10);

  assert.equal(metrics.netHitRate, 0.5);
  assert.notEqual(metrics.netHitRate, 1);
});

function assertClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} is not close to ${expected}`);
}