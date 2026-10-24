/** Cabeçalhos mínimos de imagem para os testes (o servidor só lê o cabeçalho). */
const u32be = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

function pngChunk(type: string, data: Buffer) {
  return Buffer.concat([u32be(data.length), Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
}

export function png(width: number, height: number, { animated = false } = {}): Buffer {
  const ihdr = Buffer.concat([u32be(width), u32be(height), Buffer.from([8, 6, 0, 0, 0])]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    ...(animated ? [pngChunk("acTL", Buffer.alloc(8))] : []),
    pngChunk("IDAT", Buffer.alloc(16, 1)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0", "latin1"), Buffer.alloc(9)]);
  const sof = Buffer.from([0xff, 0xc2, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, ...Array(9).fill(0)]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xda, 0x00, 0x02]), Buffer.alloc(32, 7)]);
}

function riff(chunk: string, payload: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length + 12);
  const csize = Buffer.alloc(4);
  csize.writeUInt32LE(payload.length);
  return Buffer.concat([Buffer.from("RIFF"), size, Buffer.from("WEBP"), Buffer.from(chunk, "latin1"), csize, payload]);
}

export function webpLossless(width: number, height: number): Buffer {
  const bits = Buffer.alloc(4);
  bits.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14));
  return riff("VP8L", Buffer.concat([Buffer.from([0x2f]), bits, Buffer.alloc(16)]));
}

export function webpLossy(width: number, height: number): Buffer {
  const dims = Buffer.alloc(4);
  dims.writeUInt16LE(width, 0);
  dims.writeUInt16LE(height, 2);
  return riff("VP8 ", Buffer.concat([Buffer.from([0, 0, 0, 0x9d, 0x01, 0x2a]), dims, Buffer.alloc(16)]));
}

export function webpExtended(width: number, height: number, { animated = false } = {}): Buffer {
  const p = Buffer.alloc(10);
  p[0] = animated ? 0x02 : 0;
  p.writeUIntLE(width - 1, 4, 3);
  p.writeUIntLE(height - 1, 7, 3);
  return riff("VP8X", Buffer.concat([p, Buffer.alloc(16)]));
}

export function multipart(filename: string, content: Buffer) {
  const boundary = "----resenhatest";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, content, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}
