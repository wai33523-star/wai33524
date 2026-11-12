# Barra Factor Analyzer

繁體中文股票因子分析工具，可在 Replit 使用，也可整個應用程式在自己的電腦本機運行。

## 在本機啟動

需求：Node.js 24、pnpm 10。

```sh
pnpm install
pnpm local
```

開啟 `http://127.0.0.1:19358`。啟動器會先建置 API，再啟動本機網站與 API；按 `Ctrl+C` 停止。

首次啟動會把內附行情快照複製到使用者家目錄的 `.barra-factor-analyzer/market-data.sqlite`。之後的行情更新會寫入這個本機 SQLite 檔案，程式關閉或重新啟動後仍會保留。若要改用其他路徑，可在啟動前設定 `MARKET_DATABASE_PATH`。

一般分析、歷史、恆指選股與估值查詢都讀取本機 SQLite，不會連接行情服務。按工作台的 **更新行情** 才會連網：更新目前代號和恆生指數的日線，並嘗試更新目前代號的公司基本面資料。恆指估值卡片另有 **更新恒指估值資料** 按鈕，會嘗試更新 53 隻核心候選股的公開基本面資料。成功取得的資料都會保存到本機。若更新失敗，先前已保存的資料不會刪除。

## Replit 執行

Replit 版本使用隨 API 發佈的唯讀 SQLite 快照。Replit 執行環境不會寫入使用者的本機資料庫。

## 開發與驗證

- `pnpm run typecheck` — 檢查 workspace 型別
- `pnpm --filter @workspace/api-server run test` — 執行 API 測試
- `pnpm --filter @workspace/api-server run build` — 建置 API
- `pnpm --filter @workspace/api-spec run codegen` — 從 OpenAPI 重新產生 API 用戶端與驗證結構
- `pnpm --filter @workspace/db run snapshot:export` — 從既有 Replit PostgreSQL 匯出新的唯讀 SQLite 快照

本機執行不需要 `DATABASE_URL`。需要行情更新時，才需要可連上外部行情服務的網絡。
