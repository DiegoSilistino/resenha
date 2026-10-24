import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import type { BackupInfo, BackupSnapshot } from "@resenha/shared";
import type { Db } from "../db.ts";
import type { Store } from "../store.ts";
import { tarStream, type TarEntry } from "./tar.ts";

/** Cópias diárias do banco guardadas no servidor. */
export const KEEP_DAILY = 7;
const SNAPSHOT = /^resenha-\d{4}-\d{2}-\d{2}\.db$/;
const LAST_DOWNLOAD_KEY = "backup.lastDownloadAt";

export interface BackupDirs {
  data: string;
  backups: string;
  uploads: string;
  avatars: string;
}

/**
 * Backups em duas camadas:
 * - todo dia, uma cópia do banco em DATA_DIR/backups (as últimas 7). Protege contra apagar algo
 *   sem querer ou corromper o banco, mas some junto se a VPS se perder;
 * - sob demanda, um .tar completo (banco + anexos + fotos) que o administrador baixa no PC.
 */
export class BackupService {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    readonly dirs: BackupDirs,
  ) {}

  async init(): Promise<void> {
    await mkdir(this.dirs.backups, { recursive: true });
    await this.removeLeftovers(0);
  }

  /** Apaga sobras de downloads ou cópias interrompidos (ex.: servidor reiniciou no meio). */
  async removeLeftovers(olderThanMs: number): Promise<void> {
    const cutoff = Date.now() - olderThanMs;
    for (const name of await readdir(this.dirs.backups)) {
      if (!name.startsWith("download-") && !name.endsWith(".tmp")) continue;
      const file = path.join(this.dirs.backups, name);
      const info = await stat(file).catch(() => null);
      if (info && info.mtimeMs <= cutoff) await rm(file, { force: true });
    }
  }

  /**
   * Cópia consistente do banco com o app rodando: VACUUM INTO lê uma foto instantânea
   * (as escritas que chegam durante a cópia simplesmente não entram nela).
   */
  snapshotTo(file: string): void {
    this.db.prepare("VACUUM INTO ?").run(file);
  }

  /** Cria a cópia do dia (UTC) se ainda não existir e apaga as mais antigas. Devolve o nome criado. */
  async ensureDaily(now = new Date()): Promise<string | null> {
    const name = `resenha-${now.toISOString().slice(0, 10)}.db`;
    const file = path.join(this.dirs.backups, name);
    if (await exists(file)) return null;
    const tmp = `${file}.tmp`;
    await rm(tmp, { force: true });
    this.snapshotTo(tmp);
    await rename(tmp, file); // só aparece com o nome final depois de completa
    await this.prune();
    return name;
  }

  async listSnapshots(): Promise<BackupSnapshot[]> {
    const names = (await readdir(this.dirs.backups)).filter((n) => SNAPSHOT.test(n)).sort().reverse();
    const out: BackupSnapshot[] = [];
    for (const name of names) {
      const info = await stat(path.join(this.dirs.backups, name)).catch(() => null);
      if (info) out.push({ name, size: info.size, createdAt: info.mtimeMs });
    }
    return out;
  }

  private async prune(): Promise<void> {
    const names = (await readdir(this.dirs.backups)).filter((n) => SNAPSHOT.test(n)).sort().reverse();
    for (const old of names.slice(KEEP_DAILY)) await rm(path.join(this.dirs.backups, old), { force: true });
  }

  async info(): Promise<BackupInfo> {
    const last = this.store.getMeta(LAST_DOWNLOAD_KEY);
    const { page_count } = this.db.prepare("PRAGMA page_count").get() as { page_count: number };
    const { page_size } = this.db.prepare("PRAGMA page_size").get() as { page_size: number };
    const files = (await dirSize(this.dirs.uploads)) + (await dirSize(this.dirs.avatars));
    let disk: BackupInfo["disk"] = null;
    try {
      const s = await statfs(this.dirs.data);
      disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
    } catch {
      // sistema de arquivos sem statfs: só não mostra o disco
    }
    return {
      lastDownloadAt: last ? Number(last) : null,
      snapshots: await this.listSnapshots(),
      totalBytes: page_count * page_size + files,
      disk,
    };
  }

  /**
   * Backup completo em .tar, na mesma estrutura de DATA_DIR (resenha.db, uploads/, avatars/),
   * para restaurar é só extrair dentro da pasta de dados.
   */
  archive(now = new Date()): { filename: string; stream: AsyncGenerator<Buffer> } {
    const tmp = path.join(this.dirs.backups, `download-${randomUUID()}.db`);
    this.snapshotTo(tmp);
    const { uploads, avatars } = this.dirs;
    const store = this.store;

    async function* entries(): AsyncGenerator<TarEntry> {
      yield* fileEntry(tmp, "resenha.db");
      for (const [dir, prefix] of [
        [uploads, "uploads"],
        [avatars, "avatars"],
      ] as const) {
        yield { name: prefix, type: "dir", size: 0, mtime: Date.now() };
        const names = await readdir(dir).catch(() => [] as string[]);
        for (const name of names.sort()) yield* fileEntry(path.join(dir, name), `${prefix}/${name}`);
      }
    }

    async function* stream(): AsyncGenerator<Buffer> {
      try {
        yield* tarStream(entries());
        store.setMeta(LAST_DOWNLOAD_KEY, String(Date.now()));
      } finally {
        await rm(tmp, { force: true });
      }
    }

    return { filename: `resenha-backup-${now.toISOString().slice(0, 10)}.tar`, stream: stream() };
  }
}

/**
 * Abre o arquivo antes de anunciar o tamanho: se ele for apagado durante o download
 * (alguém apagou a mensagem), o Linux mantém o conteúdo acessível pelo descritor aberto.
 */
async function* fileEntry(file: string, name: string): AsyncGenerator<TarEntry> {
  const fh = await open(file, "r").catch(() => null);
  if (!fh) return; // sumiu antes de abrir: fica de fora
  try {
    const info = await fh.stat();
    if (!info.isFile()) return;
    yield {
      name,
      type: "file",
      size: info.size,
      mtime: info.mtimeMs,
      body: () => fh.createReadStream({ autoClose: false, start: 0 }),
    };
  } finally {
    await fh.close();
  }
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const info = await stat(path.join(dir, name)).catch(() => null);
    if (info?.isFile()) total += info.size;
  }
  return total;
}
