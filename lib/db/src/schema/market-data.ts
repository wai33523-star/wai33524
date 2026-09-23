import {
  date,
  doublePrecision,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const marketDailyPricesTable = pgTable(
  "market_daily_prices",
  {
    ticker: text("ticker").notNull(),
    tradingDate: date("trading_date", { mode: "string" }).notNull(),
    adjustedClose: doublePrecision("adjusted_close").notNull(),
    rawClose: doublePrecision("raw_close").notNull(),
    volume: doublePrecision("volume").notNull(),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.ticker, table.tradingDate] })],
);

export const marketSnapshotsTable = pgTable("market_snapshots", {
  ticker: text("ticker").primaryKey(),
  name: text("name").notNull(),
  currency: text("currency").notNull(),
  latestPrice: doublePrecision("latest_price").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  source: text("source").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMarketDailyPriceSchema = createInsertSchema(marketDailyPricesTable);
export const insertMarketSnapshotSchema = createInsertSchema(marketSnapshotsTable);
export type MarketDailyPrice = typeof marketDailyPricesTable.$inferSelect;
export type InsertMarketDailyPrice = z.infer<typeof insertMarketDailyPriceSchema>;
export type MarketSnapshot = typeof marketSnapshotsTable.$inferSelect;
export type InsertMarketSnapshot = z.infer<typeof insertMarketSnapshotSchema>;