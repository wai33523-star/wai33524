import { Router, type IRouter, type Request, type Response } from "express";
import { GetHsiValueRecoveryPicksResponse } from "@workspace/api-zod";
import { hsiCoreUniverse } from "../lib/hsi-universe";
import { selectValuePicks } from "../lib/valuation-selection";
import { loadRankedMetrics, rankRecoveryMetrics } from "./hsi-quality";
import { loadHsiValuationAssessments } from "./valuation";
import { isLocalMarketDataMode } from "../lib/market-snapshot";

const router: IRouter = Router();
const CACHE_TTL_MS = 15 * 60_000;
let cache: { expiresAt: number; response: unknown } | null = null;
let pending: Promise<unknown> | null = null;

async function loadValueRecoveryPicks() {
  const [assessments, rankedMetrics] = await Promise.all([
    loadHsiValuationAssessments(),
    loadRankedMetrics(),
  ]);
  const recoveryMetrics = rankRecoveryMetrics(rankedMetrics);
  const recoveryByTicker = new Map(recoveryMetrics.map((item) => [item.ticker, item]));
  const topValueTickers = new Set(selectValuePicks(assessments).map((item) => item.ticker));
  const valueEligible = assessments.filter((item) => (
    item.latestEps !== null
    && item.latestEps > 0
    && item.trailingPe !== null
    && item.trailingPe > 0
    && item.peMedian !== null
    && !topValueTickers.has(item.ticker)
  ));
  const combined = valueEligible.flatMap((valuation) => {
    const recovery = recoveryByTicker.get(valuation.ticker);
    if (!recovery) return [];
    const score = Math.round(valuation.opportunityScore * 0.55 + recovery.score * 0.45);
    return [{
      valuation,
      recovery,
      score,
    }];
  });

  if (combined.length < 5) {
    throw new Error(`Only ${combined.length} HSI candidates have both value and recovery data`);
  }

  const picks = [...combined]
    .sort((a, b) => b.score - a.score || b.valuation.opportunityScore - a.valuation.opportunityScore || a.valuation.ticker.localeCompare(b.valuation.ticker))
    .slice(0, 5)
    .map((item, index) => ({
      rank: index + 1,
      ticker: item.valuation.ticker,
      name: item.valuation.name,
      sector: hsiCoreUniverse.find((candidate) => candidate.ticker === item.valuation.ticker)?.sector ?? "—",
      score: item.score,
      valueScore: item.valuation.opportunityScore,
      recoveryScore: Number(item.recovery.score.toFixed(1)),
      latestEps: item.valuation.latestEps as number,
      latestTtmEps: item.valuation.latestTtmEps,
      ttmEpsAsOf: item.valuation.ttmEpsAsOf,
      trailingPe: item.valuation.trailingPe as number,
      peDiscountVsMedian: item.valuation.peDiscountVsMedian as number,
      momentum12m: Number((item.recovery.laggardnessScore ?? 0).toFixed(1)),
      momentum6m: Number((item.recovery.recoveryScore ?? 0).toFixed(1)),
      dataEndDate: item.recovery.dataEndDate,
      reason: `性價比 ${item.valuation.opportunityScore}分；落後度 ${(item.recovery.laggardnessScore ?? 0).toFixed(0)}分；近期改善 ${(item.recovery.recoveryScore ?? 0).toFixed(0)}分`,
    }));
  const asOf = combined.reduce(
    (latest, item) => item.valuation.priceAsOf < latest ? item.valuation.priceAsOf : latest,
    picks[0].dataEndDate,
  );
  return GetHsiValueRecoveryPicksResponse.parse({
    asOf,
    source: "Yahoo Finance Fundamentals Timeseries · Yahoo Finance EOD（SQLite 本地快照备用）",
    universeSize: hsiCoreUniverse.length,
    evaluatedCount: assessments.length,
    eligibleCount: combined.length,
    picks,
    model: "補充性價比55% + 落後反轉潛力45%；排除上方五隻最高性價比股票，只納入正 EPS、有效 P/E 及歷史估值中位數完整的股票，再從相對12個月落後群體中按近期改善、穩定度、回撤韌性和流動性排序",
    limitation: `這是53隻核心恒指候選股中排除最高性價比五隻後，${combined.length} 隻同時具備正 EPS 估值資料及落後反轉訊號的公開數據篩選，不代表完整恒指93隻成分股；不等於基本面反轉或必然上升，不構成投資建議。`,
  });
}

router.get("/market/hsi-value-recovery-picks", async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isLocalMarketDataMode() && cache && cache.expiresAt > Date.now()) {
      res.json(cache.response);
      return;
    }
    if (!pending) {
      pending = loadValueRecoveryPicks().finally(() => {
        pending = null;
      });
    }
    const response = await pending;
    if (!isLocalMarketDataMode()) {
      cache = { expiresAt: Date.now() + CACHE_TTL_MS, response };
    }
    res.json(response);
  } catch (error) {
    req.log.error({ err: error }, "HSI value recovery selection failed");
    res.status(502).json({ error: "恒指候選股資料不足，暫時無法完成性價比及落後潛力篩選" });
  }
});

export default router;