import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const apiEntry = path.join(appRoot, "api", "index.mjs");

async function findAvailablePort(startPort = 19358) {
  for (let port = startPort; port < startPort + 20; port += 1) {
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });
    if (available) return port;
  }
  throw new Error("找不到可用的本機連接埠，請關閉其他本機服務後重試。");
}

async function waitForServer(url, processHandle) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (processHandle.exitCode !== null) {
      throw new Error("本機 API 意外停止，請查看啟動視窗中的錯誤訊息。");
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("本機服務啟動逾時，請查看啟動視窗中的錯誤訊息。");
}

async function openBrowser(url) {
  if (process.platform !== "win32") {
    console.info(`Open ${url} in your browser.`);
    return;
  }
  const browser = spawn("cmd.exe", ["/c", "start", "", url], {
    detached: true,
    stdio: "ignore",
  });
  browser.unref();
}

const port = await findAvailablePort();
const url = `http://127.0.0.1:${port}`;
const service = spawn(process.execPath, [apiEntry], {
  cwd: appRoot,
  env: {
    ...process.env,
    LOCAL_APP_STATIC_DIR: path.join(appRoot, "web"),
    MARKET_DATA_MODE: "local",
    NODE_ENV: "production",
    PORT: String(port),
  },
  stdio: "inherit",
});

let stopping = false;
const stopService = () => {
  if (stopping) return;
  stopping = true;
  if (service.exitCode === null) service.kill();
};

process.on("SIGINT", stopService);
process.on("SIGTERM", stopService);
service.once("error", (error) => {
  console.error("無法啟動本機服務：", error);
  process.exitCode = 1;
  stopService();
});
service.once("exit", (code) => {
  process.exitCode = code ?? 0;
});

console.info("正在啟動 Barra 因子分析本機版…");
console.info("首次啟動會在使用者家目錄建立本機 SQLite 資料庫。");
try {
  await waitForServer(`${url}/api/healthz`, service);
  await openBrowser(url);
  console.info(`程式已啟動：${url}`);
  console.info("關閉這個視窗即可停止本機服務。");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stopService();
  process.exitCode = 1;
}
