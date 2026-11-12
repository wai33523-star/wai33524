import { Router, type IRouter } from "express";
import {
  GetFactorAnalysisParams,
  GetFactorAnalysisResponse,
  GetHistoricalBacktestQueryParams,
} from "@workspace/api-zod";
import { normalizeTickerInput } from "../lib/ticker";
import { calculateCostMetrics } from "../lib/backtest-cost";
import { rollingZScore } from "../lib/factor-math";
import { loadSnapshotHistoryFromDate } from "../lib/market-snapshot";

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        currency?: string;
        symbol?: string;
        shortName?: string;
        longName?: string;
        currentTradingPeriod?: {
          regular?: { start?: number; end?: number };
        };
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
        adjclose?: Array<{
          adjclose?: Array<number | null>;
        }>;
      };
    } | null>;
    error?: { description?: string } | null;
  };
};

type MarketRow = {
  timestamp: number;
  /** Adjusted close used for factor and return calculations. */
  close: number;
  /** Raw close used only for latest-price and turnover display. */
  rawClose?: number;
  volume: number;
};

type MarketFetchResult = {
  rows: MarketRow[];
  name?: string;
  currency?: string;
  source?: string;
};

type InvestingHistoricalResponse = {
  data?: Array<{
    rowDateRaw?: number;
    last_closeRaw?: string | number;
    volumeRaw?: number;
  }>;
};

const router: IRouter = Router();
const yahooRowsCache = new Map<string, { expiresAt: number; result: MarketFetchResult }>();
const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

function dateParameter(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function fetchInvestingHsiRows(months = 28): Promise<MarketRow[]> {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - months);
  const params = new URLSearchParams({
    "start-date": dateParameter(startDate),
    "end-date": dateParameter(endDate),
    interval: "P1D",
    "time-frame": "Daily",
  });
  const response = await fetch(
    `https://api.investing.com/api/financialdata/historical/179?${params.toString()}`,
    {
      headers: {
        "Cache-Control": "no-cache",
        "User-Agent": "Barra-Factor-Analyzer/1.0",
        "X-Requested-With": "XMLHttpRequest",
        "domain-id": "www",
        Origin: "https://www.investing.com",
        Referer: "https://www.investing.com/",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Investing.com returned ${response.status}`);
  }

  const payload = (await response.json()) as InvestingHistoricalResponse;
  return (payload.data ?? [])
    .map((row) => ({
      timestamp: Number(row.rowDateRaw),
      close: Number(row.last_closeRaw),
      volume: Number(row.volumeRaw),
    }))
    .filter(
      (row): row is MarketRow =>
        Number.isFinite(row.timestamp) &&
        Number.isFinite(row.close) &&
        Number.isFinite(row.volume) &&
        row.close > 0,
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

async function fetchYahooRows(ticker: string, months = 28): Promise<MarketFetchResult> {
  const cacheKey = `${ticker}:${months}`;
  const cached = yahooRowsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  // Fetch ~28 months to support the 252-day Z-score window plus the 252-day RSTR window
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - months);
  const period1 = Math.floor(startDate.getTime() / 1000);
  const period2 = Math.floor(endDate.getTime() / 1000);

  let payload: YahooChartResponse | undefined;
  let lastStatus = 0;
  for (const host of YAHOO_HOSTS) {
    const response = await fetch(
      `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=history&includePrePost=false`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Barra-Factor-Analyzer/1.0)",
        },
      },
    );
    if (response.ok) {
      payload = (await response.json()) as YahooChartResponse;
      break;
    }
    lastStatus = response.status;
  }
  if (!payload) throw new Error(`Yahoo Finance returned ${lastStatus || 503}`);

  const chart = payload.chart?.result?.[0];
  const timestamps = chart?.timestamp ?? [];
  const quote = chart?.indicators?.quote?.[0];
  const rawCloses = quote?.close ?? [];
  const adjustedCloses = chart?.indicators?.adjclose?.[0]?.adjclose ?? [];
  const volumes = quote?.volume ?? [];
  const regularSession = chart?.meta?.currentTradingPeriod?.regular;
  const nowSeconds = Date.now() / 1000;
  const marketIsOpen =
    typeof regularSession?.start === "number" &&
    typeof regularSession.end === "number" &&
    nowSeconds >= regularSession.start &&
    nowSeconds < regularSession.end;

  const result = {
    rows: timestamps
      .map((timestamp, index): MarketRow | null => {
        const close = adjustedCloses[index];
        const rawClose = rawCloses[index];
        const volume = volumes[index];
        if (
          typeof close !== "number" ||
          !Number.isFinite(close) ||
          close <= 0 ||
          typeof rawClose !== "number" ||
          !Number.isFinite(rawClose) ||
          rawClose <= 0 ||
          typeof volume !== "number" ||
          !Number.isFinite(volume) ||
          volume < 0 ||
          (
            marketIsOpen &&
            typeof regularSession?.start === "number" &&
            timestamp >= regularSession.start - 3600
          )
        ) return null;
        return { timestamp, close, rawClose, volume };
      })
      .filter((row): row is MarketRow => row !== null)
       .sort((a, b) => a.timestamp - b.timestamp)
       .filter((row, index, rows) => index === 0 || row.timestamp !== rows[index - 1].timestamp),
    name: chart?.meta?.longName ?? chart?.meta?.shortName ?? chart?.meta?.symbol,
    currency: chart?.meta?.currency,
  };
  if (result.rows.length) {
    yahooRowsCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, result });
  }
  return result;
}

function toDateString(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

async function loadStoredMarketRows(
  ticker: string,
  months: number,
): Promise<MarketFetchResult | null> {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  const records = loadSnapshotHistoryFromDate(ticker, dateParameter(startDate));
  if (!records.length) return null;
  return {
    rows: records.map((record) => ({
      timestamp: Math.floor(Date.parse(`${record.tradingDate}T00:00:00Z`) / 1000),
      close: record.adjustedClose,
      rawClose: record.rawClose,
      volume: record.volume,
    })),
    name: records[records.length - 1].name,
    currency: records[records.length - 1].currency,
    source: `${records[records.length - 1].source}（本地快照）`,
  };
}

async function getHistoricalMarketData(
  ticker: string,
  months: number,
): Promise<MarketFetchResult> {
  const errors: unknown[] = [];
  if (ticker === "^HSI") {
    try {
      const rows = await fetchInvestingHsiRows(months);
      if (!rows.length) throw new Error("Investing.com returned no rows");
      const result = { rows, name: "HANG SENG INDEX", currency: "HKD", source: "Investing.com" };
      return result;
    } catch (error) {
      errors.push(error);
    }
  }

  try {
    const result = await fetchYahooRows(ticker, months);
    if (!result.rows.length) throw new Error("Yahoo Finance returned no rows");
    result.source = "Yahoo Finance";
    return result;
  } catch (error) {
    errors.push(error);
  }

  const stored = await loadStoredMarketRows(ticker, months);
  if (stored) return stored;
  throw new AggregateError(errors, `No external or local snapshot history available for ${ticker}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Factor calculation: matches the Python Barra engine exactly
//
//  RSTR_Raw[i] = log(close[i-21] / close[i-252])   (12-month log-return, skip 1 month)
//  STOM_Log[i] = log(Σ volume[j] for j in [i-20..i]  + 1)  (1-month turnover proxy)
//  Both Z-scored with a rolling 252-day window (sample std, pandas ddof=1)
// ──────────────────────────────────────────────────────────────────────────────
function computeAllFactors(rows: MarketRow[]): {
  rstrZSeries: (number | null)[];
  stomZSeries: (number | null)[];
  divergenceAlert: boolean;
  crowdingRiskLevel: "資料不足" | "正常" | "偏高" | "極端風險";
  crowdingScore: number;
  crowdingDrivers: string[];
  crowdingAnalysis: string;
  crowdingWindowStart: string;
  crowdingWindowEnd: string;
  averageVolume: number;
  momentumWindowStart: string;
  momentumWindowEnd: string;
  liquidityWindowStart: string;
  liquidityWindowEnd: string;
} {
  const n = rows.length;

  // ── RSTR_Raw: log(close[i-21] / close[i-252]) for i >= 252 ──
  const rstrRaw: (number | null)[] = new Array(n).fill(null);
  for (let i = 252; i < n; i++) {
    const num = rows[i - 21].close;
    const den = rows[i - 252].close;
    if (den > 0) rstrRaw[i] = Math.log(num / den);
  }

  // ── STOM_Log: log(sum(volume[i-20..i]) + 1) for i >= 20 ──
  const stomLog: (number | null)[] = new Array(n).fill(null);
  const volPrefix = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i++) volPrefix[i + 1] = volPrefix[i] + rows[i].volume;
  for (let i = 20; i < n; i++) {
    const windowVol = volPrefix[i + 1] - volPrefix[i - 20];
    stomLog[i] = Math.log(windowVol + 1);
  }

  // ── Rolling Z-scores using a 252-day sliding window ──
  const rstrZSeries = rollingZScore(rstrRaw, 252);
  const stomZSeries = rollingZScore(stomLog, 252);

  // Latest valid values
  const latestRstrZ = rstrZSeries[n - 1] ?? 0;
  const latestStomZ = stomZSeries[n - 1] ?? 0;

  // ── Divergence alert: STOM Z > 2.0 and RSTR Z < 0 ──
  const divergenceAlert = latestStomZ > 2.0 && latestRstrZ < 0;

  // Crowding proxy: this is intentionally single-name historical crowding,
  // not a cross-sectional fund-positioning percentile. Extreme factor
  // readings are weighted with their persistence over the recent month.
  const hasStandardizedHistory = n >= 504 &&
    rstrZSeries[n - 1] !== null && stomZSeries[n - 1] !== null;
  let crowdingScore = 0;
  const crowdingDrivers: string[] = [];
  let crowdingRiskLevel: "資料不足" | "正常" | "偏高" | "極端風險" = "資料不足";
  let crowdingAnalysis = "歷史資料不足以建立完整的個股擁擠度代理，暫不作出風險判斷。";
  let crowdingWindowStart = toDateString(rows[0].timestamp);
  let crowdingWindowEnd = toDateString(rows[n - 1].timestamp);

  if (hasStandardizedHistory) {
    const rstrExtreme = Math.min(Math.abs(latestRstrZ) / 3, 1);
    const stomExtreme = Math.min(Math.max(latestStomZ, 0) / 3, 1);
    let persistentDays = 0;
    for (let i = n - 1; i >= 0 && persistentDays < 21; i--) {
      const r = rstrZSeries[i];
      const s = stomZSeries[i];
      if (r !== null && s !== null && (Math.abs(r) >= 1.5 || s >= 1.5)) persistentDays++;
      else break;
    }
    const persistenceScore = Math.min(persistentDays / 10, 1) * 30;
    crowdingScore = Math.round(Math.min(rstrExtreme * 35 + stomExtreme * 35 + persistenceScore, 100));
    if (Math.abs(latestRstrZ) >= 1.5) crowdingDrivers.push(`RSTR 極端（Z=${latestRstrZ.toFixed(2)}）`);
    if (latestStomZ >= 1.5) crowdingDrivers.push(`STOM 高位（Z=${latestStomZ.toFixed(2)}）`);
    if (persistentDays >= 3) crowdingDrivers.push(`極端讀數連續 ${persistentDays} 個交易日`);
    crowdingRiskLevel = crowdingScore >= 70 ? "極端風險" : crowdingScore >= 40 ? "偏高" : "正常";
    crowdingWindowStart = toDateString(rows[Math.max(n - 252, 0)].timestamp);
    if (crowdingRiskLevel === "極端風險") {
      crowdingAnalysis = "因子讀數已處於歷史極端區間，且近期交易活躍度或因子方向有持續性，存在擁擠交易退潮與波動放大的風險。";
    } else if (crowdingRiskLevel === "偏高") {
      crowdingAnalysis = "個股因子讀數較近期歷史明顯偏離，擁擠度正在升高。若動能或成交活躍度快速反轉，回撤可能放大。";
    } else {
      crowdingAnalysis = "目前未見明顯的歷史極端因子集中，個股擁擠度代理維持在正常範圍。";
    }
    crowdingWindowEnd = toDateString(rows[n - 1].timestamp);
  }

  // ── Window dates for display ──
  const momentumWindowStart = toDateString(rows[Math.max(n - 253, 0)].timestamp);
  const momentumWindowEnd = toDateString(rows[n - 22].timestamp);
  const liquidityWindowStart = toDateString(rows[n - 21].timestamp);
  const liquidityWindowEnd = toDateString(rows[n - 1].timestamp);

  // Average volume over last 21 days (for display)
  const avgVol21 = (volPrefix[n] - volPrefix[n - 21]) / 21;

  return {
    rstrZSeries,
    stomZSeries,
    divergenceAlert,
    crowdingRiskLevel,
    crowdingScore,
    crowdingDrivers,
    crowdingAnalysis,
    crowdingWindowStart,
    crowdingWindowEnd,
    averageVolume: avgVol21,
    momentumWindowStart,
    momentumWindowEnd,
    liquidityWindowStart,
    liquidityWindowEnd,
  };
}

router.get("/factors/:ticker", async (req, res): Promise<void> => {
  const normalizedTicker = normalizeTickerInput(req.params.ticker);
  const parsedParams = GetFactorAnalysisParams.safeParse({
    ...req.params,
    ticker: normalizedTicker,
  });
  if (!parsedParams.success) {
    req.log.warn(
      { input: req.params.ticker, errors: parsedParams.error.message },
      "Invalid ticker",
    );
    res.status(400).json({ error: "請輸入有效的股票代號，例如 0700.HK" });
    return;
  }

  const ticker = parsedParams.data.ticker;

  try {
    const market = await getHistoricalMarketData(ticker, 28);
    const rows = market.rows;
    const source = market.source ?? "Yahoo Finance";
    const name = market.name ?? (ticker === "^HSI" ? "HANG SENG INDEX" : ticker);
    const currency = market.currency ?? (ticker === "^HSI" ? "HKD" : "—");

    // Need at least 253 rows for RSTR_Raw + 252 rows for Z-score = 504 total
    if (rows.length < 504) {
      req.log.info({ ticker, rows: rows.length }, "Insufficient market data for Z-score");
      res.status(404).json({ error: "找不到足夠的日線資料（需約 2 年歷史），請確認股票代號" });
      return;
    }

    const factors = computeAllFactors(rows);

    const series = rows.map((row, index) => ({
      date: toDateString(row.timestamp),
      close: row.close,
      volume: row.volume,
      return: index === 0 ? null : row.close / rows[index - 1].close - 1,
      rstrZ: factors.rstrZSeries[index] ?? null,
      stomZ: factors.stomZSeries[index] ?? null,
    }));

    const latestRstrZ = factors.rstrZSeries[rows.length - 1] ?? 0;
    const latestStomZ = factors.stomZSeries[rows.length - 1] ?? 0;

    const result = {
      ticker,
      name,
      currency,
      source,
      fetchedAt: new Date().toISOString(),
      startDate: series[0].date,
      endDate: series[series.length - 1].date,
      momentum: latestRstrZ,
      liquidity: latestStomZ,
      divergenceAlert: factors.divergenceAlert,
      crowdingRiskLevel: factors.crowdingRiskLevel,
      crowdingScore: factors.crowdingScore,
      crowdingDrivers: factors.crowdingDrivers,
      crowdingAnalysis: factors.crowdingAnalysis,
      crowdingWindowStart: factors.crowdingWindowStart,
      crowdingWindowEnd: factors.crowdingWindowEnd,
       latestClose: rows[rows.length - 1].rawClose ?? rows[rows.length - 1].close,
      averageVolume: factors.averageVolume,
       averageTurnoverProxy:
         factors.averageVolume * (rows[rows.length - 1].rawClose ?? rows[rows.length - 1].close),
      momentumWindowStart: factors.momentumWindowStart,
      momentumWindowEnd: factors.momentumWindowEnd,
      liquidityWindowStart: factors.liquidityWindowStart,
      liquidityWindowEnd: factors.liquidityWindowEnd,
      series,
    };

    res.json(GetFactorAnalysisResponse.parse(result));
  } catch (error) {
    req.log.error({ err: error, ticker }, "Factor analysis failed");
    res.status(502).json({ error: "抓取市場資料時發生錯誤，請稍後再試" });
  }
});

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function safePercent(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

router.get("/backtest/:ticker", async (req, res): Promise<void> => {
  const normalizedTicker = normalizeTickerInput(req.params.ticker);
  const parsedTicker = GetFactorAnalysisParams.safeParse({
    ...req.params,
    ticker: normalizedTicker,
  });
  const parsedCosts = GetHistoricalBacktestQueryParams.safeParse({
    feeBps: req.query.feeBps,
    slippageBps: req.query.slippageBps,
    rstrThreshold: req.query.rstrThreshold,
    stomThreshold: req.query.stomThreshold,
    shortDays: req.query.shortDays,
    mediumDays: req.query.mediumDays,
    longDays: req.query.longDays,
  });
  if (!parsedTicker.success || !parsedCosts.success) {
    res.status(400).json({ error: "請輸入有效的股票代號，例如 0700.HK" });
    return;
  }

  const ticker = parsedTicker.data.ticker;
  const feeBps = parsedCosts.data.feeBps;
  const slippageBps = parsedCosts.data.slippageBps;
  const { rstrThreshold, stomThreshold, shortDays, mediumDays, longDays } = parsedCosts.data;
  try {
    const market = await getHistoricalMarketData(ticker, 60);
    const rows = market.rows;
    const source = market.source ?? "Yahoo Finance";
    const name = market.name ?? (ticker === "^HSI" ? "HANG SENG INDEX" : ticker);
    const currency = market.currency ?? (ticker === "^HSI" ? "HKD" : "—");

    // Factor warm-up requires 504 observations; the longest configurable
    // backtest also needs one execution day plus its forward holding period.
    if (rows.length < 505 + longDays) {
      res.status(404).json({ error: "歷史資料不足，回測至少需要約 3 年 EOD 日線資料" });
      return;
    }

    const factors = computeAllFactors(rows);
    const periods = [
      { key: "short", label: "短期", tradingDays: shortDays },
      { key: "medium", label: "中期", tradingDays: mediumDays },
      { key: "long", label: "長期", tradingDays: longDays },
    ] as const;

    // Signal is evaluated after an EOD close. It is recorded only when both
    // factors newly confirm above zero, preventing repeated daily entries.
    const signals: Array<{
      signalIndex: number;
      executionIndex: number;
      rstrZ: number;
      stomZ: number;
    }> = [];
    for (let i = 1; i < rows.length - 1; i++) {
      const rstr = factors.rstrZSeries[i];
      const stom = factors.stomZSeries[i];
      const previousRstr = factors.rstrZSeries[i - 1];
      const previousStom = factors.stomZSeries[i - 1];
      const confirmed = rstr !== null && stom !== null && rstr > rstrThreshold && stom > stomThreshold;
      const previouslyConfirmed = previousRstr !== null && previousStom !== null && previousRstr > rstrThreshold && previousStom > stomThreshold;
      if (confirmed && !previouslyConfirmed) {
        signals.push({ signalIndex: i, executionIndex: i + 1, rstrZ: rstr, stomZ: stom });
      }
    }

    const calculatePeriodResults = (costBps: number) => periods.map((period) => {
      const returns = signals
        .filter((signal) => signal.executionIndex + period.tradingDays < rows.length)
        .map((signal) => rows[signal.executionIndex + period.tradingDays].close / rows[signal.executionIndex].close - 1)
        .filter(Number.isFinite);
      const hits = returns.filter((value) => value > 0).length;
      const costMetrics = calculateCostMetrics(returns, costBps);
      return {
        ...period,
        completedSamples: returns.length,
        hitCount: hits,
        hitRate: returns.length ? hits / returns.length : 0,
        averageReturn: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0,
        medianReturn: median(returns),
        bestReturn: returns.length ? Math.max(...returns) : 0,
        worstReturn: returns.length ? Math.min(...returns) : 0,
        ...costMetrics,
      };
    });
    const totalRoundTripBps = 2 * (feeBps + slippageBps);
    const periodResults = calculatePeriodResults(totalRoundTripBps);
    const costScenarios = [
      { feeBps: 0, slippageBps: 0 },
      { feeBps: 5, slippageBps: 5 },
      { feeBps: 10, slippageBps: 5 },
      { feeBps: 20, slippageBps: 10 },
      { feeBps: 100, slippageBps: 100 },
    ].map((scenario) => ({
      ...scenario,
      totalRoundTripBps: 2 * (scenario.feeBps + scenario.slippageBps),
      periods: calculatePeriodResults(2 * (scenario.feeBps + scenario.slippageBps)),
    }));
    if (!costScenarios.some((scenario) => scenario.feeBps === feeBps && scenario.slippageBps === slippageBps)) {
      costScenarios.push({ feeBps, slippageBps, totalRoundTripBps, periods: periodResults });
    }

    const trends = periods.map((period) => {
      const latestIndex = rows.length - 1;
      const startIndex = latestIndex - period.tradingDays;
      const totalReturn = rows[latestIndex].close / rows[startIndex].close - 1;
      const annualizedReturn = Math.pow(1 + totalReturn, 252 / period.tradingDays) - 1;
      const direction = totalReturn > 0.05 ? "上升" : totalReturn < -0.05 ? "下降" : "横行";
      const analysis = direction === "上升"
        ? `${period.label}收市價較窗口起點上升 ${(totalReturn * 100).toFixed(2)}%，趨勢偏正，但仍需觀察 RSTR 是否維持零軸上方。`
        : direction === "下降"
          ? `${period.label}收市價較窗口起點下跌 ${(Math.abs(totalReturn) * 100).toFixed(2)}%，趨勢偏弱，反彈宜等待動能與成交同步改善。`
          : `${period.label}價格變化在 ±5% 內，屬區間或橫行格局，方向性突破需要成交活躍度確認。`;
      return {
        label: period.label,
        tradingDays: period.tradingDays,
        return: safePercent(totalReturn),
        annualizedReturn: safePercent(annualizedReturn),
        direction,
        analysis,
      };
    });

    const recentSignals = signals.slice(-8).reverse().map((signal) => {
      const returns: Record<string, number> = {};
      for (const period of periods) {
        const exitIndex = signal.executionIndex + period.tradingDays;
        if (exitIndex < rows.length) {
          returns[period.key] = safePercent(rows[exitIndex].close / rows[signal.executionIndex].close - 1);
        }
      }
      return {
        signalDate: toDateString(rows[signal.signalIndex].timestamp),
        executionDate: toDateString(rows[signal.executionIndex].timestamp),
        executionClose: rows[signal.executionIndex].close,
        rstrZ: signal.rstrZ,
        stomZ: signal.stomZ,
        returns,
      };
    });

    res.json({
      ticker,
      name,
      currency,
      source,
      fetchedAt: new Date().toISOString(),
      startDate: toDateString(rows[0].timestamp),
      endDate: toDateString(rows[rows.length - 1].timestamp),
      signalDefinition: `RSTR Z-score > ${rstrThreshold} 且 STOM Z-score > ${stomThreshold}；仅在双因子由未确认转为确认时记录一次。`,
      executionRule: "信号于收市后产生，下一交易日以 EOD 收市价作为回测执行价；未完成持有周期不计入命中率。",
      totalSignals: signals.length,
      parameters: { rstrThreshold, stomThreshold, shortDays, mediumDays, longDays },
       costAssumptions: { feeBps, slippageBps, totalRoundTripBps },
       costScenarios,
      trends,
      periods: periodResults,
      recentSignals,
    });
  } catch (error) {
    req.log.error({ err: error, ticker }, "Historical backtest failed");
    res.status(502).json({ error: "回測資料抓取或計算失敗，請稍後再試" });
  }
});

export default router;

export { getHistoricalMarketData };
