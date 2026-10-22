import { createWriteStream } from "node:fs";
import { mkdir, open, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

/** Arquivos ficam em DATA_DIR/uploads/<id>, sem extensão: o tipo vem do banco. */
export class UploadStorage {
  constructor(readonly dir: string) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  pathFor(id: string): string {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("id de arquivo inválido");
    return path.join(this.dir, id);
  }

  /** Grava o stream; devolve o tamanho final e os primeiros bytes para detectar o tipo. */
  async save(id: string, stream: Readable): Promise<{ size: number; head: Buffer }> {
    const file = this.pathFor(id);
    await pipeline(stream, createWriteStream(file, { flags: "wx" }));
    const { size } = await stat(file);
    const head = Buffer.alloc(32);
    const fh = await open(file, "r");
    try {
      const { bytesRead } = await fh.read(head, 0, head.length, 0);
      return { size, head: head.subarray(0, bytesRead) };
    } finally {
      await fh.close();
    }
  }

  async remove(ids: Iterable<string>): Promise<void> {
    await Promise.all([...ids].map((id) => rm(this.pathFor(id), { force: true })));
  }

  /** Apaga arquivos no disco sem registro no banco (ex.: canal apagado em cascata, upload que falhou). */
  async removeUnknown(known: Set<string>, minAgeMs: number): Promise<number> {
    let removed = 0;
    const cutoff = Date.now() - minAgeMs;
    for (const name of await readdir(this.dir)) {
      if (known.has(name)) continue;
      const file = path.join(this.dir, name);
      const info = await stat(file).catch(() => null);
      if (info?.isFile() && info.mtimeMs < cutoff) {
        await rm(file, { force: true });
        removed++;
      }
    }
    return removed;
  }
}
