import { Router, type IRouter } from "express";
import {
  GetMarketHistoryQueryParams,
  GetMarketHistoryResponse,
  GetRealtimeMarketDataParams,
  GetRealtimeMarketDataResponse,
} from "@workspace/api-zod";
import { normalizeTickerInput } from "../lib/ticker";
import { loadNewestSnapshotHistory, loadSnapshotQuote } from "../lib/market-snapshot";

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        currency?: string;
        symbol?: string;
        shortName?: string;
        longName?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    } | null>;
  };
};

type Snapshot = {
  timestamp: number;
  price: number;
};

type SnapshotResult = Snapshot & {
  name: string;
  currency: string;
  source: string;
};

const router: IRouter = Router();
const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

function latestSnapshot(payload: YahooChartResponse): Snapshot | null {
  const chart = payload.chart?.result?.[0];
  const timestamps = chart?.timestamp ?? [];
  const closes = chart?.indicators?.quote?.[0]?.close ?? [];

  for (let index = timestamps.length - 1; index >= 0; index -= 1) {
    const timestamp = timestamps[index];
    const price = closes[index];
    if (
      typeof timestamp === "number" &&
      typeof price === "number" &&
      Number.isFinite(timestamp) &&
      Number.isFinite(price)
    ) {
      return { timestamp, price };
    }
  }

  return null;
}

async function fetchYahooChart(
  ticker: string,
  range: "1d" | "5d",
  interval: "1m" | "1d",
): Promise<YahooChartResponse> {
  let lastStatus = 0;
  for (const host of YAHOO_HOSTS) {
    const response = await fetch(
      `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&events=history&includePrePost=false`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Barra-Factor-Analyzer/1.0)",
        },
      },
    );
    if (response.ok) return (await response.json()) as YahooChartResponse;
    lastStatus = response.status;
  }
  throw new Error(`Yahoo Finance returned ${lastStatus || 503}`);
}

function sinaSymbol(ticker: string): string {
  if (ticker === "^HSI") return "rt_hkHSI";
  const hongKongMatch = ticker.match(/^(\d{1,5})\.HK$/);
  if (hongKongMatch) return `hk${hongKongMatch[1].padStart(5, "0")}`;
  return `gb_${ticker.toLowerCase()}`;
}

async function fetchSinaSnapshot(ticker: string): Promise<SnapshotResult> {
  const symbol = sinaSymbol(ticker);
  const response = await fetch(`https://hq.sinajs.cn/list=${encodeURIComponent(symbol)}`, {
    headers: {
      Accept: "text/plain",
      Referer: "https://finance.sina.com.cn/",
      "User-Agent": "Mozilla/5.0 (compatible; Barra-Factor-Analyzer/1.0)",
    },
  });
  if (!response.ok) throw new Error(`Sina Finance returned ${response.status}`);
  const body = new TextDecoder("gb18030").decode(await response.arrayBuffer());
  const quoted = body.match(/="([^"]*)"/)?.[1];
  if (!quoted) throw new Error("Sina Finance returned an empty quote");
  const fields = quoted.split(",");

  if (symbol.startsWith("gb_")) {
    const price = Number(fields[1]);
    const observedAt = Date.parse(`${fields[3].replace(" ", "T")}+08:00`);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(observedAt)) {
      throw new Error("Sina Finance returned an invalid US quote");
    }
    return {
      timestamp: Math.floor(observedAt / 1000),
      price,
      name: fields[0] || ticker,
      currency: "USD",
      source: "Sina Finance",
    };
  }

  const price = Number(fields[6]);
  const date = fields[17]?.replaceAll("/", "-");
  const time = fields[18];
  const observedAt = Date.parse(`${date}T${time}+08:00`);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(observedAt)) {
    throw new Error("Sina Finance returned an invalid Hong Kong quote");
  }
  return {
    timestamp: Math.floor(observedAt / 1000),
    price,
    name: fields[1] || fields[0] || ticker,
    currency: "HKD",
    source: "Sina Finance",
  };
}

async function loadStoredSnapshot(ticker: string): Promise<SnapshotResult | null> {
  const record = loadSnapshotQuote(ticker);
  if (!record) return null;
  return {
    timestamp: Math.floor(record.observedAt.getTime() / 1000),
    price: record.latestPrice,
    name: record.name,
    currency: record.currency,
    source: `${record.source}（本地快照）`,
  };
}

router.get("/market/realtime/:ticker", async (req, res): Promise<void> => {
  const normalizedTicker = normalizeTickerInput(req.params.ticker);
  const parsedParams = GetRealtimeMarketDataParams.safeParse({
    ...req.params,
    ticker: normalizedTicker,
  });

  if (!parsedParams.success) {
    req.log.warn(
      { input: req.params.ticker, errors: parsedParams.error.message },
      "Invalid realtime ticker",
    );
    res.status(400).json({ error: "請輸入有效的市場代號" });
    return;
  }

  const ticker = parsedParams.data.ticker;

  try {
    let snapshotResult: SnapshotResult | null = null;
    let granularity: "1m" | "1d" = "1m";
    try {
      let payload = await fetchYahooChart(ticker, "1d", "1m");
      let snapshot = latestSnapshot(payload);
      if (!snapshot) {
        payload = await fetchYahooChart(ticker, "5d", "1d");
        snapshot = latestSnapshot(payload);
        granularity = "1d";
      }
      const meta = payload.chart?.result?.[0]?.meta;
      if (snapshot) {
        snapshotResult = {
          ...snapshot,
          name: meta?.longName ?? meta?.shortName ?? meta?.symbol ?? ticker,
          currency: meta?.currency ?? "—",
          source: "Yahoo Finance",
        };
      }
    } catch (error) {
      req.log.warn({ err: error, ticker }, "Yahoo realtime unavailable; falling back to Sina");
    }

    if (!snapshotResult) {
      try {
        snapshotResult = await fetchSinaSnapshot(ticker);
        granularity = "1m";
      } catch (error) {
        req.log.warn({ err: error, ticker }, "Sina realtime unavailable; falling back to stored snapshot");
        snapshotResult = await loadStoredSnapshot(ticker);
        granularity = "1d";
      }
    }

    if (!snapshotResult) {
      res.status(502).json({ error: "目前沒有可用的市場價格資料" });
      return;
    }
    const result = {
      ticker,
      name: snapshotResult.name,
      currency: snapshotResult.currency,
      latestPrice: snapshotResult.price,
      updatedAt: new Date(snapshotResult.timestamp * 1000).toISOString(),
      source: snapshotResult.source,
      granularity,
      isIntraday: granularity === "1m",
    };

    res.json(GetRealtimeMarketDataResponse.parse(result));
  } catch (error) {
    req.log.error({ err: error, ticker }, "Realtime market update failed");
    res.status(502).json({ error: "抓取即時市場資料時發生錯誤，請稍後再試" });
  }
});

router.get("/market/history/:ticker", async (req, res): Promise<void> => {
  const normalizedTicker = normalizeTickerInput(req.params.ticker);
  const parsedParams = GetMarketHistoryQueryParams.safeParse(req.query);
  const parsedTicker = GetRealtimeMarketDataParams.safeParse({
    ...req.params,
    ticker: normalizedTicker,
  });

  if (!parsedTicker.success || !parsedParams.success) {
    res.status(400).json({ error: "請輸入有效的市場代號和交易日數" });
    return;
  }

  const ticker = parsedTicker.data.ticker;
  const days = parsedParams.data.days;

  try {
    const newestFirst = loadNewestSnapshotHistory(ticker, days);

    if (!newestFirst.length) {
      res.status(404).json({ error: "本地快照沒有這個代號的日線資料" });
      return;
    }

    const records = newestFirst.reverse();
    const points = records.map((record, index) => {
      const previous = records[index - 1];
      const change = previous ? record.adjustedClose - previous.adjustedClose : null;
      return {
        date: record.tradingDate,
        close: record.adjustedClose,
        change,
        changePercent: previous ? change! / previous.adjustedClose : null,
        volume: record.volume,
      };
    });
    const fetchedAt = records.reduce(
      (latest, record) => (record.fetchedAt > latest ? record.fetchedAt : latest),
      records[0].fetchedAt,
    );
    const sources = Array.from(new Set(records.map((record) => record.source))).join(" + ");

    res.json(
      GetMarketHistoryResponse.parse({
        ticker,
        name: records[records.length - 1].name,
        currency: records[records.length - 1].currency,
        source: `${sources} · SQLite 本地快照`,
        fetchedAt: fetchedAt.toISOString(),
        startDate: records[0].tradingDate,
        endDate: records[records.length - 1].tradingDate,
        points,
      }),
    );
  } catch (error) {
    req.log.error({ err: error, ticker }, "Local market snapshot query failed");
    res.status(500).json({ error: "讀取本地日線快照時發生錯誤" });
  }
});

export default router;