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

export function isLocalMarketDataMode(): boolean {
  return process.env.MARKET_DATA_MODE === "local";
}

function getCompressedSnapshotPath(): string {
  const appDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(appDir, "data", "market-snapshot.sqlite.gz"),
    path.resolve(appDir, "../../data/market-snapshot.sqlite.gz"),
  ];
  const snapshotPath = candidates.find(existsSync);
  if (!snapshotPath) {
    throw new Error(`Local market snapshot is missing. Checked: ${candidates.join(", ")}`);
  }
  return snapshotPath;
}

function openMarketDatabase(): DatabaseSync {
  if (database) return database;

  const compressedPath = getCompressedSnapshotPath();
  if (!existsSync(compressedPath)) {
    throw new Error(`Local market snapshot is missing: ${compressedPath}`);
  }

  if (isLocalMarketDataMode()) {
    const localPath = process.env.MARKET_DATABASE_PATH
      ? path.resolve(process.env.MARKET_DATABASE_PATH)
      : path.join(os.homedir(), ".barra-factor-analyzer", "market-data.sqlite");
    mkdirSync(path.dirname(localPath), { recursive: true });
    if (!existsSync(localPath)) {
      writeFileSync(localPath, gunzipSync(readFileSync(compressedPath)));
    }
    database = new DatabaseSync(localPath);
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS market_fundamentals (
        ticker TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
    `);
    return database;
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

export function initializeLocalMarketDatabase(): void {
  if (!isLocalMarketDataMode()) return;
  openMarketDatabase();
}

export function closeMarketDatabase(): void {
  database?.close();
  database = null;
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
  const rows = openMarketDatabase()
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
  const rows = openMarketDatabase()
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
  const row = openMarketDatabase()
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

export type MarketDataWriteRow = {
  timestamp: number;
  close: number;
  rawClose?: number;
  volume: number;
};

export function saveMarketHistory(
  ticker: string,
  name: string,
  currency: string,
  source: string,
  rows: MarketDataWriteRow[],
): number {
  if (!isLocalMarketDataMode()) {
    throw new Error("Market data can only be written in local mode.");
  }
  if (!rows.length) throw new Error(`No market rows were supplied for ${ticker}.`);

  const db = openMarketDatabase();
  const fetchedAt = new Date().toISOString();
  const insertDaily = db.prepare(`
    INSERT INTO market_daily_prices
      (ticker, trading_date, adjusted_close, raw_close, volume, name, currency, source, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ticker, trading_date) DO UPDATE SET
      adjusted_close = excluded.adjusted_close,
      raw_close = excluded.raw_close,
      volume = excluded.volume,
      name = excluded.name,
      currency = excluded.currency,
      source = excluded.source,
      fetched_at = excluded.fetched_at
  `);
  const insertQuote = db.prepare(`
    INSERT INTO market_snapshots
      (ticker, name, currency, latest_price, observed_at, source, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ticker) DO UPDATE SET
      name = excluded.name,
      currency = excluded.currency,
      latest_price = excluded.latest_price,
      observed_at = excluded.observed_at,
      source = excluded.source,
      fetched_at = excluded.fetched_at
  `);

  const orderedRows = [...rows].sort((a, b) => a.timestamp - b.timestamp);
  db.exec("BEGIN");
  try {
    for (const row of orderedRows) {
      const tradingDate = new Date(row.timestamp * 1000).toISOString().slice(0, 10);
      insertDaily.run(
        ticker,
        tradingDate,
        row.close,
        row.rawClose ?? row.close,
        row.volume,
        name,
        currency,
        source,
        fetchedAt,
      );
    }
    const latest = orderedRows[orderedRows.length - 1];
    insertQuote.run(
      ticker,
      name,
      currency,
      latest.rawClose ?? latest.close,
      new Date(latest.timestamp * 1000).toISOString(),
      source,
      fetchedAt,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return orderedRows.length;
}

export function loadLocalFundamentals<T>(ticker: string): T | null {
  if (!isLocalMarketDataMode()) return null;
  const row = openMarketDatabase()
    .prepare("SELECT payload FROM market_fundamentals WHERE ticker = ?")
    .get(ticker) as { payload: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.payload) as T;
}

export function saveLocalFundamentals<T>(ticker: string, payload: T): void {
  if (!isLocalMarketDataMode()) {
    throw new Error("Fundamentals can only be written in local mode.");
  }
  openMarketDatabase()
    .prepare(`
      INSERT INTO market_fundamentals (ticker, payload, fetched_at)
      VALUES (?, ?, ?)
      ON CONFLICT(ticker) DO UPDATE SET
        payload = excluded.payload,
        fetched_at = excluded.fetched_at
    `)
    .run(ticker, JSON.stringify(payload), new Date().toISOString());
}
