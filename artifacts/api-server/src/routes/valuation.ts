import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetHsiValuationPicksResponse,
  GetValuationAssessmentParams,
  GetValuationAssessmentResponse,
} from "@workspace/api-zod";
import { getHistoricalMarketData } from "./factors";
import { hsiCoreUniverse } from "../lib/hsi-universe";
import { normalizeTickerInput } from "../lib/ticker";
import { selectValuePicks, valueForMoneyScore } from "../lib/valuation-selection";

type FundamentalPoint = {
  asOfDate: string;
  value: number;
  currencyCode?: string;
};

type FundamentalsResult = {
  trailingPeRatio: FundamentalPoint[];
  forwardPeRatio: FundamentalPoint[];
  annualDilutedEPS: FundamentalPoint[];
  trailingDilutedEPS: FundamentalPoint[];
  annualTotalRevenue: FundamentalPoint[];
  annualNetIncome: FundamentalPoint[];
};

type YahooTimeseriesEntry = {
  meta?: { type?: string[] };
  [key: string]: unknown;
};

type YahooTimeseriesResponse = {
  timeseries?: {
    result?: YahooTimeseriesEntry[];
    error?: { description?: string } | null;
  };
};

const router: IRouter = Router();
const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const FUNDAMENTAL_TYPES = [
  "trailingPeRatio",
  "forwardPeRatio",
  "annualDilutedEPS",
  "trailingDilutedEPS",
  "annualTotalRevenue",
  "annualNetIncome",
];
const FUNDAMENTAL_CACHE_TTL_MS = 15 * 60_000;
const fundamentalsCache = new Map<string, { expiresAt: number; result: FundamentalsResult }>();
let hsiValuationCache: { expiresAt: number; response: unknown } | null = null;
let hsiValuationPromise: Promise<Awaited<ReturnType<typeof buildValuationAssessment>>[]> | null = null;

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") return null;
  const raw = (value as { raw?: unknown }).raw;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function parseSeries(result: YahooTimeseriesEntry[], type: string): FundamentalPoint[] {
  const entry = result.find((item) => item.meta?.type?.includes(type));
  const values = entry?.[type];
  if (!Array.isArray(values)) return [];
  const parsed: Array<FundamentalPoint | null> = values
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const value = numberValue((item as { reportedValue?: unknown }).reportedValue);
      const asOfDate = (item as { asOfDate?: unknown }).asOfDate;
      if (value === null || typeof asOfDate !== "string" || !asOfDate) return null;
      return {
        asOfDate,
        value,
        currencyCode: typeof (item as { currencyCode?: unknown }).currencyCode === "string"
          ? (item as { currencyCode: string }).currencyCode
          : undefined,
      };
    })
  return parsed
    .filter((item): item is FundamentalPoint => item !== null)
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
}

async function fetchYahooFundamentals(ticker: string): Promise<FundamentalsResult> {
  const cached = fundamentalsCache.get(ticker);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const period2 = Math.floor(Date.now() / 1000) + 86_400;
  let lastStatus = 0;
  let payload: YahooTimeseriesResponse | null = null;
  for (const host of YAHOO_HOSTS) {
    const url = `https://${host}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(ticker)}?symbol=${encodeURIComponent(ticker)}&type=${FUNDAMENTAL_TYPES.join(",")}&merge=false&period1=0&period2=${period2}`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; Barra-Factor-Analyzer/1.0)",
      },
    });
    if (response.ok) {
      payload = (await response.json()) as YahooTimeseriesResponse;
      break;
    }
    lastStatus = response.status;
  }
  if (!payload) throw new Error(`Yahoo fundamentals returned ${lastStatus || 503}`);
  if (payload.timeseries?.error) {
    throw new Error(payload.timeseries.error.description ?? "Yahoo fundamentals returned an error");
  }

  const result = payload.timeseries?.result ?? [];
  const parsed: FundamentalsResult = {
    trailingPeRatio: parseSeries(result, "trailingPeRatio"),
    forwardPeRatio: parseSeries(result, "forwardPeRatio"),
    annualDilutedEPS: parseSeries(result, "annualDilutedEPS"),
    trailingDilutedEPS: parseSeries(result, "trailingDilutedEPS"),
    annualTotalRevenue: parseSeries(result, "annualTotalRevenue"),
    annualNetIncome: parseSeries(result, "annualNetIncome"),
  };
  fundamentalsCache.set(ticker, { expiresAt: Date.now() + FUNDAMENTAL_CACHE_TTL_MS, result: parsed });
  return parsed;
}

function latest<T extends FundamentalPoint>(series: T[]): T | null {
  return series.length ? series[series.length - 1] : null;
}

function previous<T extends FundamentalPoint>(series: T[]): T | null {
  return series.length > 1 ? series[series.length - 2] : null;
}

function growth(latestValue: number | null, previousValue: number | null): number | null {
  if (latestValue === null || previousValue === null || previousValue <= 0 || latestValue < 0) return null;
  return latestValue / previousValue - 1;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function percentile(value: number | null, values: number[]): number | null {
  if (value === null || !values.length) return null;
  const below = values.filter((item) => item < value).length;
  const equal = values.filter((item) => item === value).length;
  return ((below + equal / 2) / values.length) * 100;
}

function latestDate(values: Array<string | null>, fallback: string): string {
  const dates = values.filter((value): value is string => Boolean(value)).sort();
  return dates.at(-1) ?? fallback;
}

async function buildValuationAssessment(ticker: string) {
  const [market, fundamentals] = await Promise.all([
    getHistoricalMarketData(ticker, 28),
    fetchYahooFundamentals(ticker),
  ]);
  const latestMarket = market.rows.at(-1);
  if (!latestMarket) throw new Error(`No market price available for ${ticker}`);

  const eps = latest(fundamentals.annualDilutedEPS);
  const previousEps = previous(fundamentals.annualDilutedEPS);
  const ttmEps = latest(fundamentals.trailingDilutedEPS);
  const revenue = latest(fundamentals.annualTotalRevenue);
  const previousRevenue = previous(fundamentals.annualTotalRevenue);
  const netIncome = latest(fundamentals.annualNetIncome);
  const previousNetIncome = previous(fundamentals.annualNetIncome);
  const peValues = fundamentals.trailingPeRatio.map((item) => item.value).filter((value) => value > 0);
  const pe = latest(fundamentals.trailingPeRatio.filter((item) => item.value > 0));
  const forwardPe = latest(fundamentals.forwardPeRatio.filter((item) => item.value > 0));
  const peMedian = median(peValues);
  const pePercentile = percentile(pe?.value ?? null, peValues);
  const peDiscountVsMedian = pe?.value !== undefined && peMedian !== null
    ? (peMedian - pe.value) / peMedian
    : null;
  const epsGrowth = growth(eps?.value ?? null, previousEps?.value ?? null);
  const revenueGrowth = growth(revenue?.value ?? null, previousRevenue?.value ?? null);
  const netIncomeGrowth = growth(netIncome?.value ?? null, previousNetIncome?.value ?? null);
  const growthEvidence = [
    epsGrowth !== null && epsGrowth >= 0.1,
    netIncomeGrowth !== null && netIncomeGrowth >= 0.1,
  ].some(Boolean);
  const earningsPotential = eps?.value !== undefined && eps.value > 0 && growthEvidence
    ? "較強"
    : eps?.value !== undefined && eps.value > 0
      ? "一般"
      : eps || revenue
        ? "偏弱"
        : "資料不足";
  const valuationStatus = peDiscountVsMedian === null
    ? "資料不足"
    : peDiscountVsMedian >= 0.15
      ? "低於歷史中位數"
      : peDiscountVsMedian <= -0.15
        ? "高於歷史中位數"
        : "接近歷史中位數";
  const screeningResult = earningsPotential === "資料不足" || valuationStatus === "資料不足"
    ? "資料不足"
    : earningsPotential === "較強" && valuationStatus === "低於歷史中位數"
      ? "符合"
      : earningsPotential === "較強" || valuationStatus === "低於歷史中位數"
        ? "部分符合"
        : "不符合";
  const opportunityScore = valueForMoneyScore(peDiscountVsMedian, epsGrowth, netIncomeGrowth, revenueGrowth);
  const reasons: string[] = [];
  if (eps?.value !== undefined) {
    reasons.push(eps.value > 0 ? `最新年度 EPS ${eps.value.toFixed(2)}` : `最新年度 EPS 為負數（${eps.value.toFixed(2)}）`);
  }
  if (ttmEps?.value !== undefined) reasons.push(`中期參考 TTM EPS ${ttmEps.value.toFixed(2)}（截至 ${ttmEps.asOfDate}，滾動12個月）`);
  if (epsGrowth !== null) reasons.push(`EPS 年增 ${(epsGrowth * 100).toFixed(1)}%`);
  if (revenueGrowth !== null) reasons.push(`收入年增 ${(revenueGrowth * 100).toFixed(1)}%`);
  if (netIncomeGrowth !== null) reasons.push(`淨利年增 ${(netIncomeGrowth * 100).toFixed(1)}%`);
  if (pe?.value !== undefined && peMedian !== null) {
    reasons.push(`TTM P/E ${pe.value.toFixed(1)}，較歷史中位數 ${peMedian.toFixed(1)} ${peDiscountVsMedian !== null && peDiscountVsMedian >= 0 ? '折讓' : '溢價'} ${Math.abs((peDiscountVsMedian ?? 0) * 100).toFixed(1)}%`);
  }
  if (!forwardPe) reasons.push("Yahoo 暫未提供 Forward P/E");

  const priceAsOf = new Date(latestMarket.timestamp * 1000).toISOString().slice(0, 10);
  const fundamentalDates = [
    eps?.asOfDate ?? null,
    ttmEps?.asOfDate ?? null,
    revenue?.asOfDate ?? null,
    netIncome?.asOfDate ?? null,
    pe?.asOfDate ?? null,
  ];
  return GetValuationAssessmentResponse.parse({
    ticker,
    name: market.name ?? ticker,
    currency: market.currency ?? "—",
    price: latestMarket.close,
    priceAsOf,
    source: "Yahoo Finance Fundamentals Timeseries · Yahoo Finance EOD",
    fetchedAt: new Date().toISOString(),
    dataAsOf: latestDate(fundamentalDates, priceAsOf),
    trailingPe: pe?.value ?? null,
    trailingPeAsOf: pe?.asOfDate ?? null,
    forwardPe: forwardPe?.value ?? null,
    peMedian,
    pePercentile,
    peDiscountVsMedian,
    latestEps: eps?.value ?? null,
    previousEps: previousEps?.value ?? null,
    epsGrowth,
    latestTtmEps: ttmEps?.value ?? null,
    ttmEpsAsOf: ttmEps?.asOfDate ?? null,
    latestRevenue: revenue?.value ?? null,
    previousRevenue: previousRevenue?.value ?? null,
    revenueGrowth,
    latestNetIncome: netIncome?.value ?? null,
    previousNetIncome: previousNetIncome?.value ?? null,
    netIncomeGrowth,
    earningsPotential,
    valuationStatus,
    screeningResult,
    opportunityScore,
    reason: reasons.join("；") || "目前沒有足夠基本面資料作出判斷。",
    limitation: "這是基於 Yahoo Finance 公開基本面時間序列及歷史 TTM P/E 的篩選，不是盈利預測或投資建議；Forward P/E、同業估值、管理層質素及非公開預測可能缺失。",
  });
}

export async function loadHsiValuationAssessments() {
  if (!hsiValuationPromise) {
    hsiValuationPromise = (async () => {
      const settled: PromiseSettledResult<Awaited<ReturnType<typeof buildValuationAssessment>>>[] = [];
      for (let index = 0; index < hsiCoreUniverse.length; index += 4) {
        const batch = await Promise.allSettled(
          hsiCoreUniverse.slice(index, index + 4).map((candidate) => buildValuationAssessment(candidate.ticker)),
        );
        settled.push(...batch);
      }
      const assessments = settled
        .filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof buildValuationAssessment>>> => item.status === "fulfilled")
        .map((item) => item.value);
      return assessments;
    })().finally(() => {
      hsiValuationPromise = null;
    });
  }
  return hsiValuationPromise;
}

async function loadHsiValuationPicks() {
  const assessments = await loadHsiValuationAssessments();
  // A value pick must have positive latest annual EPS. This prevents
  // stale/provider-derived P/E values from making loss-making companies
  // appear attractive.
  const valueEligible = assessments.filter((item) => (
    item.latestEps !== null
    && item.latestEps > 0
    && item.trailingPe !== null
    && item.trailingPe > 0
    && item.peMedian !== null
  ));
  const picks = selectValuePicks(assessments);
  const response = GetHsiValuationPicksResponse.parse({
    asOf: assessments.reduce((latestDateValue, item) => item.priceAsOf < latestDateValue ? item.priceAsOf : latestDateValue, assessments[0].priceAsOf),
    source: "Yahoo Finance Fundamentals Timeseries · Yahoo Finance EOD",
    universeSize: hsiCoreUniverse.length,
    evaluatedCount: assessments.length,
    qualifiedCount: assessments.filter((item) => item.screeningResult === "符合").length,
    picks,
    model: "性價比100分：估值折讓45分、EPS增長30分、淨利增長15分、收入增長10分；正 EPS 篩選使用最新年度 EPS，TTM P/E 配對中期參考 TTM EPS，並要求歷史中位數完整，按總分列出前五名",
    limitation: `這是53隻核心恒指候選股中 ${valueEligible.length} 隻正 EPS 股票的公開數據排序，不代表完整恒指93隻成分股；基本面披露日期不一，P/E可能受資料供應商更新時間影響，不構成投資建議。`,
  });
  hsiValuationCache = { expiresAt: Date.now() + FUNDAMENTAL_CACHE_TTL_MS, response };
  return response;
}

router.get("/valuation/:ticker", async (req, res): Promise<void> => {
  const ticker = normalizeTickerInput(req.params.ticker);
  const parsed = GetValuationAssessmentParams.safeParse({ ...req.params, ticker });
  if (!parsed.success) {
    res.status(400).json({ error: "請輸入有效的股票代號" });
    return;
  }
  try {
    res.json(await buildValuationAssessment(parsed.data.ticker));
  } catch (error) {
    req.log.error({ err: error, ticker }, "Valuation assessment failed");
    res.status(502).json({ error: "目前無法取得基本面估值資料，請稍後再試" });
  }
});

router.get("/market/hsi-valuation-picks", async (req: Request, res: Response): Promise<void> => {
  try {
    if (hsiValuationCache && hsiValuationCache.expiresAt > Date.now()) {
      res.json(hsiValuationCache.response);
      return;
    }
    res.json(await loadHsiValuationPicks());
  } catch (error) {
    req.log.error({ err: error }, "HSI valuation selection failed");
    res.status(502).json({ error: "恒指候選股基本面資料不足，暫時無法完成估值篩選" });
  }
});

export default router;