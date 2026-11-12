# Barra Factor Analyzer

一個以繁體中文呈現的互動式股票因子分析工具，讓使用者輸入股票代號後，以約 28 個月日線建立 Barra 動量與流動性指標。

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm local` — run the complete app on this computer at `http://127.0.0.1:19358` (Node.js 24, pnpm 10)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run snapshot:export` — refresh the checked-in read-only SQLite market snapshot from the current Replit PostgreSQL database
- `pnpm local` creates/uses a persistent writable SQLite database at `~/.barra-factor-analyzer/market-data.sqlite` (or `MARKET_DATABASE_PATH`). Ordinary analysis reads this local file; only the explicit update action contacts external market-data providers and saves updates locally.
- The hosted Replit app remains read-only and uses the packaged SQLite snapshot; runtime does not require `DATABASE_URL`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Data: persistent writable SQLite in local mode, read-only packaged SQLite snapshot in Replit mode; Replit PostgreSQL is retained as a source/backup for snapshot exports.
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/barra-factor-analyzer/src/pages/home.tsx` — 分析工作台、股票代號輸入、因子卡片與歷史圖表
- `artifacts/api-server/src/routes/factors.ts` — Yahoo Finance 資料抓取與 Barra 因子計算
- `lib/api-spec/openapi.yaml` — 因子分析 API 的來源契約
- `lib/api-client-react/src/generated/` — 由 OpenAPI 產生的前端查詢 hook

## Architecture decisions

- 使用 Yahoo Finance 公開 chart API 取得日線資料，伺服器端完成計算，前端只負責呈現結果。
- API 的历史回退资料及备用即时报价来自随服务发布的只读 SQLite 快照；刷新取得的外部行情不会写入快照。
- 本機模式的即時報價只讀取 SQLite 收市價；Replit 模式優先 Yahoo Finance，失敗時回退 Sina Finance，再讀取快照。
- Sina 即时报价不会混入 EOD 因子或历史回测，避免盘中未完成数据污染统计结果。
- 恆生指數（`^HSI`）的歷史因子資料優先使用 Investing.com 商品 ID 179，接口受限時回退至 Yahoo Finance。
- 股票輸入會先清洗：恆指別名統一為 `^HSI`，純數字港股代碼會補足四位數並加上 `.HK`。
- 動量採用 231 個交易日對數收益、排除最近 21 個交易日，並以 252 日样本標準差进行滚动标准化。
- 流動性採用最近 60 日平均成交量乘平均收市價的對數作為成交額代理值；因未取得流通股數，這不是嚴格換手率。
- 擁擠度採用單一股票自身 252 日歷史 RSTR／STOM 極端程度與持續性的代理分數；不代表全市場基金持倉擁擠度、因子橫截面百分位或資金淨流入。

## Product

- 輸入港股、美股等 Yahoo Finance 代號並抓取即時可用資料。
- 查看 RSTR 風格動量、STOM 風格流動性、最新收市價和資料區間。
- 以價格／成交量歷史圖、計算窗口說明及 CSV 匯出支援進一步研究。

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
