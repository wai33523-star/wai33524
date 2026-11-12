import pg from "pg";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to export a local snapshot.");
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "../../..");
const outputDir = path.join(workspaceRoot, "artifacts/api-server/data");
const rawPath = path.join(outputDir, "market-snapshot.sqlite");
const compressedPath = `${rawPath}.gz`;
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function isoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid timestamp in source database: ${value}`);
  return date.toISOString();
}

await mkdir(outputDir, { recursive: true });
await rm(rawPath, { force: true });

try {
  const [dailyResult, snapshotResult] = await Promise.all([
    pool.query(`
      SELECT ticker, trading_date::text AS trading_date, adjusted_close, raw_close,
             volume, name, currency, source, fetched_at
      FROM market_daily_prices
      ORDER BY ticker, trading_date
    `),
    pool.query(`
      SELECT ticker, name, currency, latest_price, observed_at, source, fetched_at
      FROM market_snapshots
      ORDER BY ticker
    `),
  ]);

  const sqlite = new DatabaseSync(rawPath);
  try {
    sqlite.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = FULL;
      PRAGMA user_version = 1;

      CREATE TABLE market_daily_prices (
        ticker TEXT NOT NULL,
        trading_date TEXT NOT NULL,
        adjusted_close REAL NOT NULL,
        raw_close REAL NOT NULL,
        volume REAL NOT NULL,
        name TEXT NOT NULL,
        currency TEXT NOT NULL,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (ticker, trading_date)
      );
      CREATE INDEX market_daily_prices_by_date
        ON market_daily_prices (ticker, trading_date DESC);

      CREATE TABLE market_snapshots (
        ticker TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        currency TEXT NOT NULL,
        latest_price REAL NOT NULL,
        observed_at TEXT NOT NULL,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
    `);

    const insertDaily = sqlite.prepare(`
      INSERT INTO market_daily_prices
        (ticker, trading_date, adjusted_close, raw_close, volume, name, currency, source, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertSnapshot = sqlite.prepare(`
      INSERT INTO market_snapshots
        (ticker, name, currency, latest_price, observed_at, source, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    sqlite.exec("BEGIN");
    for (const row of dailyResult.rows) {
      insertDaily.run(
        row.ticker,
        row.trading_date,
        Number(row.adjusted_close),
        Number(row.raw_close),
        Number(row.volume),
        row.name,
        row.currency,
        row.source,
        isoTimestamp(row.fetched_at),
      );
    }
    for (const row of snapshotResult.rows) {
      insertSnapshot.run(
        row.ticker,
        row.name,
        row.currency,
        Number(row.latest_price),
        isoTimestamp(row.observed_at),
        row.source,
        isoTimestamp(row.fetched_at),
      );
    }
    sqlite.exec("COMMIT");

    const dailyCount = sqlite.prepare("SELECT COUNT(*) AS count FROM market_daily_prices").get().count;
    const snapshotCount = sqlite.prepare("SELECT COUNT(*) AS count FROM market_snapshots").get().count;
    const integrity = sqlite.prepare("PRAGMA integrity_check").get().integrity_check;
    if (integrity !== "ok") throw new Error(`SQLite integrity check failed: ${integrity}`);
    if (Number(dailyCount) !== dailyResult.rowCount || Number(snapshotCount) !== snapshotResult.rowCount) {
      throw new Error("SQLite row counts do not match the source database.");
    }
  } finally {
    sqlite.close();
  }

  const rawBytes = await readFile(rawPath);
  const compressedBytes = gzipSync(rawBytes, { level: 9 });
  await writeFile(compressedPath, compressedBytes);
  await rm(rawPath, { force: true });
  const sha256 = createHash("sha256").update(compressedBytes).digest("hex");

  console.log(JSON.stringify({
    output: path.relative(workspaceRoot, compressedPath),
    dailyRows: dailyResult.rowCount,
    snapshotRows: snapshotResult.rowCount,
    rawBytes: rawBytes.byteLength,
    compressedBytes: compressedBytes.byteLength,
    sha256,
  }, null, 2));
} finally {
  await pool.end();
}
