import { Router, type IRouter, type Request, type Response } from "express";
import { GetHsiMoversResponse, GetHsiQualityPicksResponse } from "@workspace/api-zod";
import { getHistoricalMarketData } from "./factors";
import { hsiCoreUniverse } from "../lib/hsi-universe";

type CandidateMetrics = {
  ticker: string;
  name: string;
  sector: string;
  dataEndDate: string;
  momentum12m: number;
  momentum6m: number;
  volatility: number;
  drawdown: number;
  liquidity: number;
  recentMomentum: number;
  recentVolatility: number;
  volatilityExpansionRatio: number;
  pullbackDepth: number;
};

export type RankedMetrics = CandidateMetrics & {
  momentum12mScore: number;
  momentum6mScore: number;
  stabilityScore: number;
  drawdownResilienceScore: number;
  liquidityScore: number;
  score: number;
  laggardnessScore?: number;
  recoveryScore?: number;
  recentTrendScore?: number;
  leadingnessScore?: number;
  pullbackScore?: number;
  recentWeaknessScore?: number;
  volatilityExpansionScore?: number;
};

const router: IRouter = Router();
type SelectionMode = "quality" | "laggard" | "recovery" | "leader" | "pullback";
const cachedSelections: Partial<Record<SelectionMode, { expiresAt: number; response: unknown }>> = {};
let rankedMetricsPromise: Promise<RankedMetrics[]> | null = null;
let cachedMovers: { expiresAt: number; response: unknown } | null = null;
let moversPromise: Promise<unknown> | null = null;

function sampleStandardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function percentileScores(values: number[], higherIsBetter: boolean): number[] {
  const order = values.map((value, index) => ({ value, index }))
    .sort((a, b) => higherIsBetter ? a.value - b.value : b.value - a.value);
  const scores = new Array(values.length).fill(50);
  order.forEach((item, rank) => {
    scores[item.index] = order.length === 1 ? 50 : (rank / (order.length - 1)) * 100;
  });
  return scores;
}

function calculateMetrics(candidate: typeof hsiCoreUniverse[number], rows: Array<{ timestamp: number; close: number; volume: number }>): CandidateMetrics | null {
  if (rows.length < 253) return null;
  const latest = rows[rows.length - 1].close;
  const oneYearAgo = rows[rows.length - 253].close;
  const sixMonthsAgo = rows[Math.max(0, rows.length - 127)].close;
  const shortAnchor = rows[Math.max(0, rows.length - 22)].close;
  const recentReturns = rows.slice(-63).map((row, index, recent) => {
    if (index === 0) return null;
    return Math.log(row.close / recent[index - 1].close);
  }).filter((value): value is number => value !== null && Number.isFinite(value));
  const shortReturns = rows.slice(-22).map((row, index, recent) => {
    if (index === 0) return null;
    return Math.log(row.close / recent[index - 1].close);
  }).filter((value): value is number => value !== null && Number.isFinite(value));
  const trailingYear = rows.slice(-252).map((row) => row.close);
  const peak = Math.max(...trailingYear);
  const recentVolumes = rows.slice(-63).map((row) => row.volume).filter((value) => value > 0);
  const volatility = sampleStandardDeviation(recentReturns) * Math.sqrt(252);
  const recentVolatility = sampleStandardDeviation(shortReturns) * Math.sqrt(252);

  return {
    ticker: candidate.ticker,
    name: candidate.name,
    sector: candidate.sector,
    dataEndDate: new Date(rows[rows.length - 1].timestamp * 1000).toISOString().slice(0, 10),
    momentum12m: latest / oneYearAgo - 1,
    momentum6m: latest / sixMonthsAgo - 1,
    volatility,
    drawdown: peak > 0 ? latest / peak - 1 : -1,
    liquidity: recentVolumes.length ? Math.log1p(recentVolumes.reduce((sum, value) => sum + value, 0) / recentVolumes.length) : 0,
    recentMomentum: shortAnchor > 0 ? latest / shortAnchor - 1 : 0,
    recentVolatility,
    volatilityExpansionRatio: recentVolatility / Math.max(volatility, 0.01),
    pullbackDepth: peak > 0 ? Math.max(0, 1 - latest / peak) : 1,
  };
}

function reasonForPick(pick: RankedMetrics, mode: SelectionMode): string {
  if (mode === "recovery") {
    const reasons: Array<[number, string]> = [
      [pick.laggardnessScore ?? 0, `12個月落後度 ${(pick.laggardnessScore ?? 0).toFixed(0)}分`],
      [pick.recoveryScore ?? 0, `近期改善 ${(pick.recoveryScore ?? 0).toFixed(0)}分`],
      [pick.recentTrendScore ?? 0, `近6個月趨勢 ${(pick.recentTrendScore ?? 0).toFixed(0)}分`],
      [pick.stabilityScore, `波動穩定度 ${pick.stabilityScore.toFixed(0)}分`],
      [pick.drawdownResilienceScore, `回撤韌性 ${pick.drawdownResilienceScore.toFixed(0)}分`],
      [pick.liquidityScore, `流動性 ${pick.liquidityScore.toFixed(0)}分`],
    ];
    return reasons.sort((a, b) => b[0] - a[0]).slice(0, 2).map((reason) => reason[1]).join("；");
  }
  if (mode === "leader") {
    const reasons: Array<[number, string]> = [
      [pick.laggardnessScore ?? 0, `12個月領先度 ${(pick.laggardnessScore ?? 0).toFixed(0)}分`],
      [pick.recoveryScore ?? 0, `趨勢延續 ${(pick.recoveryScore ?? 0).toFixed(0)}分`],
      [pick.recentTrendScore ?? 0, `近6個月趨勢 ${(pick.recentTrendScore ?? 0).toFixed(0)}分`],
      [pick.stabilityScore, `波動穩定度 ${pick.stabilityScore.toFixed(0)}分`],
      [pick.drawdownResilienceScore, `回撤韌性 ${pick.drawdownResilienceScore.toFixed(0)}分`],
      [pick.liquidityScore, `流動性 ${pick.liquidityScore.toFixed(0)}分`],
    ];
    return reasons.sort((a, b) => b[0] - a[0]).slice(0, 2).map((reason) => reason[1]).join("；");
  }
  if (mode === "pullback") {
    const reasons: Array<[number, string]> = [
      [pick.leadingnessScore ?? 0, `12個月領先度 ${(pick.leadingnessScore ?? 0).toFixed(0)}分`],
      [pick.pullbackScore ?? 0, `距52週高位回檔 ${(pick.pullbackDepth * 100).toFixed(1)}%`],
      [pick.recentWeaknessScore ?? 0, `短期轉弱 ${(pick.recentWeaknessScore ?? 0).toFixed(0)}分`],
      [pick.volatilityExpansionScore ?? 0, `波動放大 ${(pick.volatilityExpansionScore ?? 0).toFixed(0)}分`],
      [pick.drawdownResilienceScore, `回撤韌性 ${pick.drawdownResilienceScore.toFixed(0)}分`],
    ];
    return reasons.sort((a, b) => b[0] - a[0]).slice(0, 2).map((reason) => reason[1]).join("；");
  }
  const reasons: Array<[number, string]> = [
    [pick.momentum12mScore, `12個月動能 ${pick.momentum12mScore.toFixed(0)}分`],
    [pick.momentum6mScore, `6個月動能 ${pick.momentum6mScore.toFixed(0)}分`],
    [pick.stabilityScore, `波動穩定度 ${pick.stabilityScore.toFixed(0)}分`],
    [pick.drawdownResilienceScore, `回撤韌性 ${pick.drawdownResilienceScore.toFixed(0)}分`],
    [pick.liquidityScore, `流動性 ${pick.liquidityScore.toFixed(0)}分`],
  ];
  return reasons.sort((a, b) => mode === "quality" ? b[0] - a[0] : a[0] - b[0]).slice(0, 2).map((reason) => reason[1]).join("；");
}

async function fetchRankedMetrics(): Promise<RankedMetrics[]> {
  const fetched: PromiseSettledResult<{ candidate: typeof hsiCoreUniverse[number]; rows: Array<{ timestamp: number; close: number; volume: number }> }>[] = [];
  for (let index = 0; index < hsiCoreUniverse.length; index += 4) {
    const batch = await Promise.allSettled(
      hsiCoreUniverse.slice(index, index + 4).map(async (candidate) => {
        const result = await getHistoricalMarketData(candidate.ticker, 28);
        return { candidate, rows: result.rows };
      }),
    );
    fetched.push(...batch);
  }
  const available = fetched
    .filter((item): item is PromiseFulfilledResult<{ candidate: typeof hsiCoreUniverse[number]; rows: Array<{ timestamp: number; close: number; volume: number }> }> => item.status === "fulfilled")
    .map((item) => item.value)
    .filter((item) => item.rows.length >= 253);

  if (available.length < 5) {
    throw new Error(`Only ${available.length} HSI constituents have enough stored history`);
  }

  const commonEndTimestamp = Math.min(...available.map((item) => item.rows[item.rows.length - 1].timestamp));
  const metrics = available
    .map((item) => calculateMetrics(item.candidate, item.rows.filter((row) => row.timestamp <= commonEndTimestamp)))
    .filter((item): item is CandidateMetrics => item !== null);
  const scoreInputs = [
    percentileScores(metrics.map((item) => item.momentum12m), true),
    percentileScores(metrics.map((item) => item.momentum6m), true),
    percentileScores(metrics.map((item) => item.volatility), false),
    percentileScores(metrics.map((item) => item.drawdown), true),
    percentileScores(metrics.map((item) => item.liquidity), true),
  ];

  const ranked: RankedMetrics[] = metrics.map((item, index) => {
    const [momentum12mScore, momentum6mScore, stabilityScore, drawdownResilienceScore, liquidityScore] = scoreInputs.map((scores) => scores[index]);
    return {
      ...item,
      momentum12mScore,
      momentum6mScore,
      stabilityScore,
      drawdownResilienceScore,
      liquidityScore,
      score: momentum12mScore * 0.30 + momentum6mScore * 0.20 + stabilityScore * 0.20 + drawdownResilienceScore * 0.15 + liquidityScore * 0.15,
    };
  }).sort((a, b) => b.score - a.score);
  return ranked;
}

export async function loadRankedMetrics(): Promise<RankedMetrics[]> {
  if (!rankedMetricsPromise) {
    rankedMetricsPromise = fetchRankedMetrics().finally(() => {
      rankedMetricsPromise = null;
    });
  }
  return rankedMetricsPromise;
}

export function rankRecoveryMetrics(ranked: RankedMetrics[]): RankedMetrics[] {
  const medianMomentum12m = [...ranked].sort((a, b) => a.momentum12m - b.momentum12m)[Math.floor(ranked.length / 2)].momentum12m;
  const laggardCandidates = ranked.filter((item) => item.momentum12m <= medianMomentum12m);
  const recoveryInputs = laggardCandidates.length >= 5 ? laggardCandidates : ranked;
  const laggardnessScores = percentileScores(recoveryInputs.map((item) => item.momentum12m), false);
  const recoveryScores = percentileScores(recoveryInputs.map((item) => item.momentum6m - item.momentum12m), true);
  const recentTrendScores = percentileScores(recoveryInputs.map((item) => item.momentum6m), true);
  return recoveryInputs.map((item, index) => {
    const laggardnessScore = laggardnessScores[index];
    const recoveryScore = recoveryScores[index];
    const recentTrendScore = recentTrendScores[index];
    return {
      ...item,
      laggardnessScore,
      recoveryScore,
      recentTrendScore,
      score: laggardnessScore * 0.30 + recoveryScore * 0.30 + recentTrendScore * 0.15 + item.stabilityScore * 0.10 + item.drawdownResilienceScore * 0.10 + item.liquidityScore * 0.05,
    };
  }).sort((a, b) => b.score - a.score);
}

async function selectQualityStocks(mode: SelectionMode) {
  const ranked = await loadRankedMetrics();
  let ordered: RankedMetrics[];
  if (mode === "recovery") {
    ordered = rankRecoveryMetrics(ranked);
  } else if (mode === "leader") {
    const leadingnessScores = percentileScores(ranked.map((item) => item.momentum12m), true);
    const continuationScores = percentileScores(ranked.map((item) => item.momentum6m - item.momentum12m), true);
    const recentTrendScores = percentileScores(ranked.map((item) => item.momentum6m), true);
    ordered = ranked.map((item, index) => {
      const leadingnessScore = leadingnessScores[index];
      const continuationScore = continuationScores[index];
      const recentTrendScore = recentTrendScores[index];
      return {
        ...item,
        laggardnessScore: leadingnessScore,
        recoveryScore: continuationScore,
        recentTrendScore,
        score: leadingnessScore * 0.30 + recentTrendScore * 0.30 + continuationScore * 0.15 + item.stabilityScore * 0.10 + item.drawdownResilienceScore * 0.10 + item.liquidityScore * 0.05,
      };
    }).sort((a, b) => b.score - a.score);
  } else if (mode === "pullback") {
    const positiveLeaders = ranked.filter((item) => item.momentum12m > 0 && item.momentum6m > 0);
    const leadingCandidates = positiveLeaders.filter((item) => item.momentum12mScore >= 50 && item.momentum6mScore >= 45);
    const pullbackInputs = leadingCandidates.length >= 5 ? leadingCandidates : positiveLeaders;
    if (pullbackInputs.length < 5) {
      throw new Error(`Only ${pullbackInputs.length} HSI leaders have positive medium and long-term momentum`);
    }
    const leadingnessScores = percentileScores(pullbackInputs.map((item) => item.momentum12m), true);
    const pullbackScores = percentileScores(pullbackInputs.map((item) => item.pullbackDepth), true);
    const recentWeaknessScores = percentileScores(pullbackInputs.map((item) => -item.recentMomentum), true);
    const volatilityExpansionScores = percentileScores(pullbackInputs.map((item) => item.volatilityExpansionRatio), true);
    ordered = pullbackInputs.map((item, index) => {
      const leadingnessScore = leadingnessScores[index];
      const pullbackScore = pullbackScores[index];
      const recentWeaknessScore = recentWeaknessScores[index];
      const volatilityExpansionScore = volatilityExpansionScores[index];
      return {
        ...item,
        leadingnessScore,
        pullbackScore,
        recentWeaknessScore,
        volatilityExpansionScore,
        score: leadingnessScore * 0.25 + pullbackScore * 0.25 + recentWeaknessScore * 0.20 + volatilityExpansionScore * 0.15 + item.stabilityScore * 0.10 + item.drawdownResilienceScore * 0.05,
      };
    }).sort((a, b) => b.score - a.score);
  } else {
    ordered = [...ranked].sort((a, b) => mode === "quality" ? b.score - a.score : a.score - b.score);
  }
  const picks = ordered.slice(0, 5).map((pick, index) => ({
    rank: index + 1,
    ticker: pick.ticker,
    name: pick.name,
    sector: pick.sector,
    score: Number(pick.score.toFixed(1)),
    momentum12m: Number((mode === "recovery" ? pick.laggardnessScore ?? 0 : mode === "pullback" ? pick.leadingnessScore ?? 0 : pick.momentum12mScore).toFixed(1)),
    momentum6m: Number((mode === "recovery" ? pick.recoveryScore ?? 0 : mode === "pullback" ? pick.pullbackScore ?? 0 : pick.momentum6mScore).toFixed(1)),
    pullbackDepth: Number(pick.pullbackDepth.toFixed(4)),
    recentWeakness: Number((pick.recentWeaknessScore ?? 0).toFixed(1)),
    volatilityExpansion: Number((pick.volatilityExpansionScore ?? 0).toFixed(1)),
    stability: Number(pick.stabilityScore.toFixed(1)),
    drawdownResilience: Number(pick.drawdownResilienceScore.toFixed(1)),
    liquidity: Number(pick.liquidityScore.toFixed(1)),
    dataEndDate: pick.dataEndDate,
    reason: reasonForPick(pick, mode),
  }));
  const asOf = picks.reduce((latest, pick) => pick.dataEndDate < latest ? pick.dataEndDate : latest, picks[0].dataEndDate);

  return GetHsiQualityPicksResponse.parse({
    asOf,
    source: "Yahoo Finance EOD（SQLite 本地快照备用）",
    universeSize: hsiCoreUniverse.length,
    scoredCount: ranked.length,
    picks,
    model: mode === "quality"
      ? "量價優質模型：12個月動能30% + 6個月動能20% + 波動穩定度20% + 回撤韌性15% + 流動性15%"
      : mode === "laggard"
        ? "量價反向模型：沿用同一評分，按綜合分由低至高列出5只最弱核心候選"
        : mode === "recovery"
          ? "落後反彈模型：12個月落後度30% + 近期改善30% + 近6個月趨勢15% + 穩定度10% + 回撤韌性10% + 流動性5%"
          : mode === "leader"
            ? "領先延續模型：12個月領先度30% + 近6個月趨勢30% + 趨勢延續15% + 穩定度10% + 回撤韌性10% + 流動性5%"
            : "領先回檔模型：12個月領先度25% + 高位回檔25% + 短期轉弱20% + 波動放大15% + 穩定度10% + 回撤韌性5%",
    limitation: mode === "quality"
      ? "這是可解釋的價格與成交量模型，從截至2026-08-31恒指93只成分股中選取53只核心候選，不代表完整93只橫截面；不包含財報、估值、新聞、管理層質素或個人投資風險評估。"
      : mode === "laggard"
        ? "這是風險觀察名單，不等於公司基本面最差，也不代表必然下跌；從截至2026-08-31恒指93只成分股中選取53只核心候選，不代表完整93只橫截面。"
        : mode === "recovery"
          ? "這是基於歷史量價改善的反彈觀察名單，不等於基本面反轉或必然上升；從截至2026-08-31恒指93只成分股中選取53只核心候選，不代表完整93只橫截面。"
          : mode === "leader"
            ? "這是基於歷史量價延續的領先觀察名單，不等於基本面優質或必然繼續上升；從截至2026-08-31恒指93只成分股中選取53只核心候選，不代表完整93只橫截面。"
            : "這是基於歷史量價回檔訊號的觀察名單，候選仍需具備正向中長期動能；不代表必然下跌或可預測回檔時點，從截至2026-08-31恒指93只成分股中選取53只核心候選，不代表完整93只橫截面。",
  });
}

async function loadHsiMovers() {
  if (!moversPromise) {
    moversPromise = (async () => {
      const fetched: PromiseSettledResult<{
        candidate: typeof hsiCoreUniverse[number];
        rows: Array<{ timestamp: number; close: number; volume: number }>;
      }>[] = [];
      for (let index = 0; index < hsiCoreUniverse.length; index += 4) {
        const batch = await Promise.allSettled(
          hsiCoreUniverse.slice(index, index + 4).map(async (candidate) => {
            const result = await getHistoricalMarketData(candidate.ticker, 28);
            return { candidate, rows: result.rows };
          }),
        );
        fetched.push(...batch);
      }

      const available = fetched
        .filter((item): item is PromiseFulfilledResult<{
          candidate: typeof hsiCoreUniverse[number];
          rows: Array<{ timestamp: number; close: number; volume: number }>;
        }> => item.status === "fulfilled")
        .map((item) => item.value)
        .filter((item) => item.rows.length >= 2);

      if (available.length < 10) {
        throw new Error(`Only ${available.length} HSI constituents have enough data for movers`);
      }

      const commonEndTimestamp = Math.min(...available.map((item) => item.rows[item.rows.length - 1].timestamp));
      const metrics = available.flatMap(({ candidate, rows }) => {
        const comparableRows = rows.filter((row) => row.timestamp <= commonEndTimestamp);
        if (comparableRows.length < 2) return [];
        const latest = comparableRows[comparableRows.length - 1];
        const previous = comparableRows[comparableRows.length - 2];
        const change = latest.close - previous.close;
        const changePercent = previous.close > 0 ? change / previous.close : 0;
        return [{
          ticker: candidate.ticker,
          name: candidate.name,
          sector: candidate.sector,
          latestPrice: latest.close,
          change,
          changePercent,
          dataEndDate: new Date(latest.timestamp * 1000).toISOString().slice(0, 10),
        }];
      });

      if (metrics.length < 10) {
        throw new Error(`Only ${metrics.length} HSI constituents have comparable mover data`);
      }

      const gainers = [...metrics]
        .filter((item) => item.changePercent > 0)
        .sort((a, b) => b.changePercent - a.changePercent)
        .slice(0, 5)
        .map((item, index) => ({ ...item, rank: index + 1 }));
      const decliners = [...metrics]
        .filter((item) => item.changePercent < 0)
        .sort((a, b) => a.changePercent - b.changePercent)
        .slice(0, 5)
        .map((item, index) => ({ ...item, rank: index + 1 }));
      const response = GetHsiMoversResponse.parse({
        asOf: new Date(commonEndTimestamp * 1000).toISOString().slice(0, 10),
        source: "Yahoo Finance EOD（SQLite 本地快照备用）",
        universeSize: hsiCoreUniverse.length,
        scoredCount: metrics.length,
        gainers,
        decliners,
        model: "最新完整交易日升跌幅排序：按核心候選股日線百分比變化列出領漲及領跌各5隻",
        limitation: "這是基於最近完整交易日價格變化的短期榜單，不代表基本面評級、下一交易日走勢或投資建議；候選範圍為53隻核心恒指股票，不代表完整恒指成分股。",
      });
      cachedMovers = { expiresAt: Date.now() + 5 * 60_000, response };
      return response;
    })().finally(() => {
      moversPromise = null;
    });
  }
  return moversPromise;
}

async function handleSelection(mode: SelectionMode, req: Request, res: Response): Promise<void> {
  try {
    const cachedSelection = cachedSelections[mode];
    if (cachedSelection && cachedSelection.expiresAt > Date.now()) {
      res.json(cachedSelection.response);
      return;
    }
    const response = await selectQualityStocks(mode);
    cachedSelections[mode] = { expiresAt: Date.now() + 5 * 60_000, response };
    res.json(response);
  } catch (error) {
    req.log.error({ err: error }, `HSI ${mode} selection failed`);
    const errorMessage = mode === "quality"
      ? "恒指成分股資料不足，暫時無法完成五隻優質股評分"
      : mode === "laggard"
        ? "恒指成分股資料不足，暫時無法完成五隻最弱股票評分"
        : mode === "pullback"
          ? "恒指成分股領先資料不足，暫時無法完成五隻回檔潛質評分"
          : "恒指成分股資料不足，暫時無法完成五隻候選股評分";
    res.status(502).json({ error: errorMessage });
  }
}

router.get("/market/hsi-movers", async (req, res): Promise<void> => {
  try {
    if (cachedMovers && cachedMovers.expiresAt > Date.now()) {
      res.json(cachedMovers.response);
      return;
    }
    const response = await loadHsiMovers();
    res.json(response);
  } catch (error) {
    req.log.error({ err: error }, "HSI movers selection failed");
    res.status(502).json({ error: "恒指成分股資料不足，暫時無法完成領漲領跌榜單" });
  }
});

router.get("/market/hsi-quality-picks", async (req, res): Promise<void> => handleSelection("quality", req, res));
router.get("/market/hsi-quality-laggards", async (req, res): Promise<void> => handleSelection("laggard", req, res));
router.get("/market/hsi-recovery-picks", async (req, res): Promise<void> => handleSelection("recovery", req, res));
router.get("/market/hsi-leader-picks", async (req, res): Promise<void> => handleSelection("leader", req, res));
router.get("/market/hsi-leader-pullback-picks", async (req, res): Promise<void> => handleSelection("pullback", req, res));

export default router;