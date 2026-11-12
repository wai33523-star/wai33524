import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = "0.1.0";
const nodeVersion = "24.22.1";
const archiveName = `node-v${nodeVersion}-win-x64.zip`;
const archiveDirectory = `node-v${nodeVersion}-win-x64`;
const generatedDir = path.join(root, "generated-artifacts");
const stageDir = path.join(generatedDir, "windows-stage");
const downloadsDir = path.join(generatedDir, "windows-downloads");
const runtimeDir = path.join(stageDir, "runtime");
const outputPath = path.join(generatedDir, "BarraFactorAnalyzer-Setup.exe");

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
}

async function ensureTool(command) {
  try {
    execFileSync(command, ["-version"], { stdio: "ignore" });
  } catch {
    throw new Error(
      `Missing build tool "${command}". Install the Linux packages "unzip" and "nsis", then retry.`,
    );
  }
}

async function downloadVerifiedNodeRuntime() {
  const baseUrl = `https://nodejs.org/dist/v${nodeVersion}/`;
  const sumsResponse = await fetch(`${baseUrl}SHASUMS256.txt`);
  if (!sumsResponse.ok) throw new Error(`Unable to download Node.js checksums (${sumsResponse.status}).`);
  const sums = await sumsResponse.text();
  const checksumLine = sums.split(/\r?\n/).find((line) => line.endsWith(`  ${archiveName}`));
  if (!checksumLine) throw new Error(`Official Node.js checksum is missing for ${archiveName}.`);
  const expectedHash = checksumLine.split(/\s+/)[0];
  const archivePath = path.join(downloadsDir, archiveName);

  try {
    await access(archivePath);
  } catch {
    const response = await fetch(`${baseUrl}${archiveName}`);
    if (!response.ok || !response.body) {
      throw new Error(`Unable to download the Windows Node.js runtime (${response.status}).`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath));
  }

  const archive = await readFile(archivePath);
  const actualHash = createHash("sha256").update(archive).digest("hex");
  if (actualHash !== expectedHash) {
    await rm(archivePath, { force: true });
    throw new Error(`Node.js runtime checksum mismatch: expected ${expectedHash}, received ${actualHash}.`);
  }
  console.info(`Verified the official Node.js ${nodeVersion} Windows x64 archive.`);

  const runtime = execFileSync("unzip", ["-p", archivePath, `${archiveDirectory}/node.exe`], {
    maxBuffer: 128 * 1024 * 1024,
  });
  await writeFile(path.join(runtimeDir, "node.exe"), runtime);
  const license = execFileSync("unzip", ["-p", archivePath, `${archiveDirectory}/LICENSE`], {
    maxBuffer: 2 * 1024 * 1024,
  });
  await mkdir(path.join(stageDir, "licenses"), { recursive: true });
  await writeFile(path.join(stageDir, "licenses", "NODE-LICENSE.txt"), license);
}

await ensureTool("unzip");
await ensureTool("makensis");
await rm(stageDir, { recursive: true, force: true });
await mkdir(runtimeDir, { recursive: true });
await mkdir(downloadsDir, { recursive: true });

const buildEnv = {
  ...process.env,
  BASE_PATH: "/",
  NODE_ENV: "production",
  PORT: "19358",
  VITE_LOCAL_APP: "true",
};

console.info("Building the API and production website…");
run("pnpm", ["--filter", "@workspace/api-server", "run", "build"], {
  env: { ...buildEnv, MARKET_DATA_MODE: "local" },
});
run("pnpm", ["--filter", "@workspace/barra-factor-analyzer", "run", "build"], {
  env: buildEnv,
});

await cp(path.join(root, "artifacts/api-server/dist"), path.join(stageDir, "api"), {
  recursive: true,
});
await cp(
  path.join(root, "artifacts/barra-factor-analyzer/dist/public"),
  path.join(stageDir, "web"),
  { recursive: true },
);
await copyFile(path.join(root, "scripts/desktop-launcher.mjs"), path.join(stageDir, "launcher.mjs"));
await writeFile(
  path.join(stageDir, "VERSION.txt"),
  `Barra Factor Analyzer ${version}\nWindows 11 x64\n`,
);
await downloadVerifiedNodeRuntime();

await rm(outputPath, { force: true });
run("makensis", [
  `-DAPP_VERSION=${version}`,
  `-DSTAGE_DIR=${stageDir}`,
  `-DOUTPUT_FILE=${outputPath}`,
  path.join(root, "installer/windows/installer.nsi"),
]);

const installer = await readFile(outputPath);
const installerHash = createHash("sha256").update(installer).digest("hex");
console.info(`Created ${path.relative(root, outputPath)} (${(installer.length / 1024 / 1024).toFixed(1)} MiB).`);
console.info(`SHA-256: ${installerHash}`);
