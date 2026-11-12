import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type MarketDailySnapshotRow = {
  ticker: string;
  tradingDate: string;
  adjustedClose: number;
  rawClose: number;
  volume: number;
  name: string;
  currency: string;
  source: string;
  fetchedAt: Date;
};

export type MarketPriceSnapshot = {
  ticker: string;
  name: string;
  currency: string;
  latestPrice: number;
  observedAt: Date;
  source: string;
  fetchedAt: Date;
};

type SqlRow = Record<string, SQLOutputValue>;

let database: DatabaseSync | null = null;

function openSnapshot(): DatabaseSync {
  if (database) return database;

  const appDir = path.dirname(fileURLToPath(import.meta.url));
  const compressedPath = path.join(appDir, "data", "market-snapshot.sqlite.gz");
  if (!existsSync(compressedPath)) {
    throw new Error(`Local market snapshot is missing: ${compressedPath}`);
  }

  const compressed = readFileSync(compressedPath);
  const hash = createHash("sha256").update(compressed).digest("hex");
  const extractedDir = path.join(os.tmpdir(), "barra-market-snapshot");
  const extractedPath = path.join(extractedDir, `${hash}.sqlite`);
  if (!existsSync(extractedPath)) {
    mkdirSync(extractedDir, { recursive: true });
    writeFileSync(extractedPath, gunzipSync(compressed), { mode: 0o444 });
  }

  database = new DatabaseSync(extractedPath, { readOnly: true });
  return database;
}

function dailyPriceFromSql(row: SqlRow): MarketDailySnapshotRow {
  return {
    ticker: String(row.ticker),
    tradingDate: String(row.trading_date),
    adjustedClose: Number(row.adjusted_close),
    rawClose: Number(row.raw_close),
    volume: Number(row.volume),
    name: String(row.name),
    currency: String(row.currency),
    source: String(row.source),
    fetchedAt: new Date(String(row.fetched_at)),
  };
}

export function loadSnapshotHistoryFromDate(
  ticker: string,
  startDate: string,
): MarketDailySnapshotRow[] {
  const rows = openSnapshot()
    .prepare(`
      SELECT ticker, trading_date, adjusted_close, raw_close, volume, name, currency, source, fetched_at
      FROM market_daily_prices
      WHERE ticker = ? AND trading_date >= ?
      ORDER BY trading_date ASC
    `)
    .all(ticker, startDate) as SqlRow[];
  return rows.map(dailyPriceFromSql);
}

export function loadNewestSnapshotHistory(
  ticker: string,
  limit: number,
): MarketDailySnapshotRow[] {
  const rows = openSnapshot()
    .prepare(`
      SELECT ticker, trading_date, adjusted_close, raw_close, volume, name, currency, source, fetched_at
      FROM market_daily_prices
      WHERE ticker = ?
      ORDER BY trading_date DESC
      LIMIT ?
    `)
    .all(ticker, limit) as SqlRow[];
  return rows.map(dailyPriceFromSql);
}

export function loadSnapshotQuote(ticker: string): MarketPriceSnapshot | null {
  const row = openSnapshot()
    .prepare(`
      SELECT ticker, name, currency, latest_price, observed_at, source, fetched_at
      FROM market_snapshots
      WHERE ticker = ?
      LIMIT 1
    `)
    .get(ticker) as SqlRow | undefined;
  if (!row) return null;
  return {
    ticker: String(row.ticker),
    name: String(row.name),
    currency: String(row.currency),
    latestPrice: Number(row.latest_price),
    observedAt: new Date(String(row.observed_at)),
    source: String(row.source),
    fetchedAt: new Date(String(row.fetched_at)),
  };
}
