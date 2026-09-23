export type ValuePickCandidate = {
  ticker: string;
  latestEps: number | null;
  trailingPe: number | null;
  peMedian: number | null;
  opportunityScore: number;
};

function cappedGrowthScore(value: number | null, cap: number, maximum: number): number {
  if (value === null || value <= 0) return 0;
  return Math.min(value, cap) / cap * maximum;
}

export function valueForMoneyScore(
  peDiscountVsMedian: number | null,
  epsGrowth: number | null,
  netIncomeGrowth: number | null,
  revenueGrowth: number | null,
): number {
  // Keep valuation from dominating growth completely, while rewarding a
  // meaningful discount and only giving growth points for positive growth.
  const valuationScore = peDiscountVsMedian === null
    ? 0
    : Math.max(0, Math.min(45, 20 + peDiscountVsMedian * 50));
  const epsScore = cappedGrowthScore(epsGrowth, 0.5, 30);
  const netIncomeScore = cappedGrowthScore(netIncomeGrowth, 0.5, 15);
  const revenueScore = cappedGrowthScore(revenueGrowth, 0.3, 10);
  return Math.round(valuationScore + epsScore + netIncomeScore + revenueScore);
}

export function selectValuePicks<T extends ValuePickCandidate>(
  assessments: readonly T[],
  limit = 5,
): T[] {
  const eligible = assessments.filter((item) => (
    item.latestEps !== null
    && item.latestEps > 0
    && item.trailingPe !== null
    && item.trailingPe > 0
    && item.peMedian !== null
  ));

  if (eligible.length < limit) {
    throw new Error(`Only ${eligible.length} candidates have complete positive-EPS valuation data`);
  }

  return [...eligible]
    .sort((a, b) => b.opportunityScore - a.opportunityScore || a.ticker.localeCompare(b.ticker))
    .slice(0, limit);
}