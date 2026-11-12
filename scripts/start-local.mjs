import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const pnpmCommand = isWindows ? "pnpm.cmd" : "pnpm";
const webPort = process.env.LOCAL_WEB_PORT ?? "19358";
const apiPort = process.env.LOCAL_API_PORT ?? "8080";
const localEnvironment = {
  ...process.env,
  MARKET_DATA_MODE: "local",
  NODE_ENV: "development",
  PORT: apiPort,
};

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: isWindows,
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} stopped (${signal ?? `exit ${code}`})`));
    });
  });
}

console.info("Building the local API...");
await run(pnpmCommand, ["--filter", "@workspace/api-server", "run", "build"]);

const children = [];
let shuttingDown = false;

function stopAll() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

const api = spawn(process.execPath, ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"], {
  cwd: root,
  stdio: "inherit",
  env: localEnvironment,
});
children.push(api);

const web = spawn(
  pnpmCommand,
  ["--filter", "@workspace/barra-factor-analyzer", "run", "dev:local"],
  {
    cwd: root,
    stdio: "inherit",
    shell: isWindows,
    env: {
      ...localEnvironment,
      LOCAL_APP: "true",
      VITE_LOCAL_APP: "true",
      LOCAL_API_PORT: apiPort,
      PORT: webPort,
      BASE_PATH: "/",
    },
  },
);
children.push(web);

for (const child of children) {
  child.once("error", (error) => {
    console.error("Unable to start a local service:", error);
    stopAll();
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`A local service stopped (${signal ?? `exit ${code}`}).`);
      stopAll();
      process.exitCode = code ?? 1;
    }
  });
}

console.info(`Local app: http://127.0.0.1:${webPort}`);
console.info(`Market database: ${process.env.MARKET_DATABASE_PATH ?? "user home folder/.barra-factor-analyzer/market-data.sqlite"}`);
console.info("Only the explicit “更新行情” action requests external market data. Press Ctrl+C to stop.");
