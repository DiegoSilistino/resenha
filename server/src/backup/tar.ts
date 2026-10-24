/**
 * Escritor mínimo de arquivos .tar (formato ustar, POSIX), em streaming.
 *
 * O backup pode ter vários GB de anexos; gerar o .tar aos pedaços mantém a memória
 * baixa e começa o download na hora. Abre no Windows (Explorer do 11, 7-Zip, `tar`)
 * e no Linux (`tar -xf`).
 */
const BLOCK = 512;

export interface TarEntry {
  /** Caminho dentro do arquivo, com "/" (ex.: "uploads/abc"). */
  name: string;
  type: "file" | "dir";
  /** Tamanho exato em bytes (0 para pastas). */
  size: number;
  /** Data de modificação, em ms. */
  mtime: number;
  /** Conteúdo do arquivo; pode devolver menos ou mais que `size`, o tar corrige. */
  body?: () => AsyncIterable<Buffer | Uint8Array>;
}

function writeString(header: Buffer, value: string, offset: number, length: number) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) throw new Error(`campo longo demais no tar: ${value}`);
  bytes.copy(header, offset);
}

function writeOctal(header: Buffer, value: number, offset: number, length: number) {
  const digits = Math.floor(value).toString(8);
  if (digits.length > length - 1) throw new Error(`número grande demais para o tar: ${value}`);
  writeString(header, digits.padStart(length - 1, "0") + "\0", offset, length);
}

export function tarHeader(entry: Pick<TarEntry, "name" | "type" | "size" | "mtime">): Buffer {
  const header = Buffer.alloc(BLOCK);
  const name = entry.type === "dir" && !entry.name.endsWith("/") ? `${entry.name}/` : entry.name;
  writeString(header, name, 0, 100);
  writeOctal(header, entry.type === "dir" ? 0o755 : 0o644, 100, 8);
  writeOctal(header, 0, 108, 8); // uid
  writeOctal(header, 0, 116, 8); // gid
  writeOctal(header, entry.type === "dir" ? 0 : entry.size, 124, 12);
  writeOctal(header, entry.mtime / 1000, 136, 12);
  header.fill(0x20, 148, 156); // soma de verificação: espaços enquanto calcula
  header[156] = entry.type === "dir" ? 0x35 : 0x30; // '5' pasta, '0' arquivo
  writeString(header, "ustar\0", 257, 6);
  writeString(header, "00", 263, 2);
  let sum = 0;
  for (const byte of header) sum += byte;
  writeString(header, sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return header;
}

const padding = (size: number) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

export async function* tarStream(entries: AsyncIterable<TarEntry> | Iterable<TarEntry>): AsyncGenerator<Buffer> {
  for await (const entry of entries) {
    yield tarHeader(entry);
    if (entry.type === "dir") continue;
    let written = 0;
    if (entry.body) {
      for await (const raw of entry.body()) {
        if (written >= entry.size) break;
        const chunk = Buffer.from(raw.buffer, raw.byteOffset, Math.min(raw.byteLength, entry.size - written));
        written += chunk.length;
        yield chunk;
      }
    }
    // arquivo encolheu no meio do caminho: completa com zeros para o tar continuar válido
    if (written < entry.size) yield Buffer.alloc(entry.size - written);
    yield padding(entry.size);
  }
  yield Buffer.alloc(BLOCK * 2); // fim do arquivo
}
