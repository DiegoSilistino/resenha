#!/usr/bin/env node
/**
 * Sobe o servidor de voz (LiveKit) para desenvolvimento, sem Docker.
 *
 * - Já tem um LiveKit respondendo na porta 7880 (Docker, outro terminal)? Usa esse.
 * - Tem `livekit-server` instalado no sistema (ex.: Homebrew no Mac)? Usa esse.
 * - Senão, baixa o binário OFICIAL do GitHub para Windows ou Linux, confere o
 *   SHA-256 (fixado abaixo) e guarda em .livekit/, para os próximos usos.
 *
 * Roda junto com `npm run dev`, ou sozinho com `npm run livekit`.
 * Se algo der errado aqui, o chat continua funcionando; só a voz fica fora.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

/** Versão testada. Para trocar, atualize também os hashes (arquivo checksums.txt da release). */
export const LIVEKIT_VERSION = "1.13.10";
export const SHA256 = {
  "livekit_1.13.10_windows_amd64.zip": "fd4b7c2c3c1e4c71adaa4f6a046ad1c0abaaaf1e09fae904b35bf231ffae11d2",
  "livekit_1.13.10_windows_arm64.zip": "887587684dae37cd21db8a16c1bae0647a48868bfaf49f6dc4e5972de4d850f1",
  "livekit_1.13.10_linux_amd64.tar.gz": "c25a3e45fb922e9a93c6443d10c0ed041ba64342097e38632331736630283165",
  "livekit_1.13.10_linux_arm64.tar.gz": "ff60607e1931ff078576882fa11c087aa5821d635ac0c47f56ff77e203e32006",
};

const PORT = 7880;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".livekit", LIVEKIT_VERSION);

const log = (msg) => console.log(`[voz] ${msg}`);

/** Nome do arquivo da release para este sistema, ou null se não houver binário oficial. */
export function assetFor(platform = process.platform, arch = process.arch) {
  const cpu = { x64: "amd64", arm64: "arm64" }[arch];
  if (!cpu) return null;
  if (platform === "win32") return `livekit_${LIVEKIT_VERSION}_windows_${cpu}.zip`;
  if (platform === "linux") return `livekit_${LIVEKIT_VERSION}_linux_${cpu}.tar.gz`;
  return null; // macOS: a release não traz binário; use o Homebrew
}

export const binaryName = (platform = process.platform) =>
  platform === "win32" ? "livekit-server.exe" : "livekit-server";

export const downloadUrl = (asset) =>
  `https://github.com/livekit/livekit/releases/download/v${LIVEKIT_VERSION}/${asset}`;

async function alreadyRunning() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function onPath(name) {
  const finder = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(finder, [name], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() || null : null;
}

async function sha256(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download falhou: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  let received = 0;
  let lastShown = -10;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    received += chunk.length;
    if (!total) return;
    const pct = Math.floor((received / total) * 100);
    if (pct >= lastShown + 10) {
      lastShown = pct - (pct % 10);
      log(`baixando… ${lastShown}%`);
    }
  });
  await pipeline(body, createWriteStream(dest));
}

function extract(archive, dir) {
  if (archive.endsWith(".zip")) {
    // O tar do próprio Windows (10 e 11) abre .zip. Chamado pelo caminho completo para não
    // pegar o tar do Git for Windows, que não entende zip. PowerShell é o plano B.
    const systemTar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    const tar = spawnSync(systemTar, ["-xf", archive, "-C", dir], { stdio: "inherit" });
    if (tar.status === 0) return;
    const ps = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: "inherit" },
    );
    if (ps.status !== 0) throw new Error("não foi possível extrair o .zip");
    return;
  }
  const r = spawnSync("tar", ["-xzf", archive, "-C", dir], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("não foi possível extrair o .tar.gz");
}

/** Garante o binário em .livekit/<versão>/ e devolve o caminho. */
export async function ensureBinary({ platform = process.platform, arch = process.arch } = {}) {
  const asset = assetFor(platform, arch);
  if (!asset) return null;
  const bin = path.join(CACHE, binaryName(platform));
  if (existsSync(bin)) return bin;

  await mkdir(CACHE, { recursive: true });
  const archive = path.join(CACHE, asset);
  const partial = `${archive}.part`;
  log(`baixando o LiveKit ${LIVEKIT_VERSION} (~19 MB, só na primeira vez)…`);
  await download(downloadUrl(asset), partial);

  const actual = await sha256(partial);
  if (actual !== SHA256[asset]) {
    await rm(partial, { force: true });
    throw new Error(`o arquivo baixado não confere (SHA-256 ${actual}); download apagado por segurança`);
  }
  await rename(partial, archive);
  extract(archive, CACHE);
  await rm(archive, { force: true });
  if (!existsSync(bin)) throw new Error(`${binaryName(platform)} não encontrado após extrair`);
  if (platform !== "win32") await chmod(bin, 0o755);
  return bin;
}

function start(bin) {
  log(`iniciando ${bin}`);
  log("se o Windows perguntar sobre o Firewall, pode clicar em Permitir (redes privadas).");
  // --dev: chave "devkey" e segredo "secret" (os mesmos que o app usa em desenvolvimento),
  // ouvindo só neste computador. --node-ip 127.0.0.1: a mídia também fica no próprio PC.
  const child = spawn(bin, ["--dev", "--node-ip", "127.0.0.1"], { stdio: "inherit" });
  const stop = () => child.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code, signal) => {
    if (signal || code === 0) process.exit(0);
    log(`o LiveKit parou (código ${code}). O chat continua funcionando; a voz não.`);
    process.exit(0); // não derruba o resto do `npm run dev`
  });
}

function giveUp(reason, hint) {
  log(`não foi possível iniciar o servidor de voz: ${reason}`);
  if (hint) log(hint);
  log("o chat funciona normalmente; só os canais de voz ficam indisponíveis.");
  process.exit(0);
}

async function main() {
  const prepareOnly = process.argv.includes("--prepare-only");

  if (!prepareOnly && (await alreadyRunning())) {
    log(`já existe um LiveKit rodando na porta ${PORT}; usando esse.`);
    return;
  }

  let bin = onPath("livekit-server");
  if (!bin) {
    if (!assetFor()) {
      return giveUp(
        `não há binário oficial para ${process.platform}/${process.arch}`,
        process.platform === "darwin" ? "no Mac, instale com: brew install livekit" : undefined,
      );
    }
    try {
      bin = await ensureBinary();
    } catch (err) {
      return giveUp(
        err.message,
        `baixe manualmente ${downloadUrl(assetFor())}, extraia em ${CACHE} e rode de novo.`,
      );
    }
  }

  if (prepareOnly) {
    log(`pronto: ${bin}`);
    return;
  }
  start(bin);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) void main();
