export type CostMetrics = {
  netHitRate: number;
  netAverageReturn: number;
  netMedianReturn: number;
  netBestReturn: number;
  netWorstReturn: number;
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Apply the round-trip cost once to each completed trade.
 *
 * feeBps and slippageBps are one-way assumptions, so callers pass their
 * combined round-trip value (2 * (feeBps + slippageBps)).
 */
export function calculateCostMetrics(returns: number[], roundTripCostBps: number): CostMetrics {
  const netReturns = returns.map((value) => value - roundTripCostBps / 10_000);
  const netHits = netReturns.filter((value) => value > 0).length;

  return {
    netHitRate: returns.length ? netHits / returns.length : 0,
    netAverageReturn: netReturns.length ? netReturns.reduce((sum, value) => sum + value, 0) / netReturns.length : 0,
    netMedianReturn: median(netReturns),
    netBestReturn: netReturns.length ? Math.max(...netReturns) : 0,
    netWorstReturn: netReturns.length ? Math.min(...netReturns) : 0,
  };
}