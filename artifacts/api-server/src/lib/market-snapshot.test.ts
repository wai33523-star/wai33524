import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const tempDir = mkdtempSync(path.join(tmpdir(), "barra-local-market-test-"));
process.env.MARKET_DATA_MODE = "local";
process.env.MARKET_DATABASE_PATH = path.join(tempDir, "market.sqlite");

const {
  closeMarketDatabase,
  loadLocalFundamentals,
  loadNewestSnapshotHistory,
  loadSnapshotQuote,
  saveLocalFundamentals,
  saveMarketHistory,
} = await import("./market-snapshot.ts");

test("writes updated market history and fundamentals to the persistent local SQLite database", () => {
  try {
    const firstDate = Date.parse("2026-11-11T00:00:00Z") / 1000;
    const latestDate = Date.parse("2026-11-12T00:00:00Z") / 1000;
    const updatedRows = saveMarketHistory("0700.HK", "Tencent", "HKD", "Yahoo Finance", [
      { timestamp: firstDate, close: 450, rawClose: 451, volume: 1000 },
      { timestamp: latestDate, close: 455, rawClose: 456, volume: 1200 },
    ]);

    assert.equal(updatedRows, 2);
    assert.deepEqual(
      loadNewestSnapshotHistory("0700.HK", 2).map((row) => row.tradingDate),
      ["2026-11-12", "2026-11-11"],
    );
    assert.equal(loadSnapshotQuote("0700.HK")?.latestPrice, 456);

    const fundamentals = { annualDilutedEPS: [{ asOfDate: "2026-06-30", value: 25.5 }] };
    saveLocalFundamentals("0700.HK", fundamentals);
    assert.deepEqual(loadLocalFundamentals("0700.HK"), fundamentals);
  } finally {
    closeMarketDatabase();
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MARKET_DATA_MODE;
    delete process.env.MARKET_DATABASE_PATH;
  }
});
