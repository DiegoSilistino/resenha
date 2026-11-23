/**
 * Lê tipo e dimensões de PNG, JPEG e WebP só pelo cabeçalho, sem decodificar a imagem.
 *
 * Serve para a foto de perfil: o servidor não tem biblioteca de imagens, então recusa
 * por aqui o que for grande demais para decodificar (uma "bomba" de 30000 x 30000 px
 * em poucos KB travaria a aba de quem visse a foto) ou animado.
 */
export interface ImageInfo {
  mime: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  animated: boolean;
}

const ascii = (buf: Buffer, start: number, end: number) => buf.subarray(start, end).toString("latin1");

export function imageInfo(buf: Buffer): ImageInfo | null {
  try {
    return png(buf) ?? jpeg(buf) ?? webp(buf);
  } catch {
    // cabeçalho truncado: leitura fora do buffer
    return null;
  }
}

/** Capa do perfil: as mesmas imagens da foto e também GIF (animado ou não). */
export function bannerInfo(buf: Buffer): { mime: ImageInfo["mime"] | "image/gif"; width: number; height: number } | null {
  const info = imageInfo(buf);
  if (info) return info;
  const sig = ascii(buf, 0, 6);
  if (buf.length < 10 || (sig !== "GIF87a" && sig !== "GIF89a")) return null;
  return { mime: "image/gif", width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function png(buf: Buffer): ImageInfo | null {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE) || ascii(buf, 12, 16) !== "IHDR") return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  // APNG: um chunk acTL antes do primeiro IDAT.
  let animated = false;
  for (let i = 8; i + 8 <= buf.length; ) {
    const length = buf.readUInt32BE(i);
    const type = ascii(buf, i + 4, i + 8);
    if (type === "acTL") animated = true;
    if (type === "IDAT" || type === "IEND") break;
    i += 12 + length;
  }
  return { mime: "image/png", width, height, animated };
}

/** Marcadores SOF (início de quadro) que trazem as dimensões; C4, C8 e CC não são SOF. */
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpeg(buf: Buffer): ImageInfo | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1]!;
    if (marker === 0xff) {
      i++; // bytes de preenchimento
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // marcadores sem tamanho
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // fim ou dados antes de achar o SOF
    const length = buf.readUInt16BE(i + 2);
    if (JPEG_SOF.has(marker)) {
      return { mime: "image/jpeg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), animated: false };
    }
    i += 2 + length;
  }
  return null;
}

function webp(buf: Buffer): ImageInfo | null {
  if (ascii(buf, 0, 4) !== "RIFF" || ascii(buf, 8, 12) !== "WEBP") return null;
  const chunk = ascii(buf, 12, 16);
  if (chunk === "VP8 ") {
    // quadro-chave: 3 bytes de tag, código de início 9d 01 2a, depois 14 bits de largura e altura
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return {
      mime: "image/webp",
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
      animated: false,
    };
  }
  if (chunk === "VP8L") {
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    return { mime: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, animated: false };
  }
  if (chunk === "VP8X") {
    const flags = buf[20]!;
    return {
      mime: "image/webp",
      width: buf.readUIntLE(24, 3) + 1,
      height: buf.readUIntLE(27, 3) + 1,
      animated: (flags & 0x02) !== 0,
    };
  }
  return null;
}
