/**
 * Descobre o tipo REAL do arquivo pelos primeiros bytes (não confiamos na extensão
 * nem no tipo informado pelo navegador). Só imagens, vídeos e áudios reconhecidos são
 * exibidos inline; todo o resto vira download (application/octet-stream), o que
 * impede que um HTML/SVG enviado execute script no domínio do app.
 */
import { audioMime } from "./audio.ts";
export interface Sniffed {
  mime: string;
  inline: boolean;
}

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

const ascii = (buf: Buffer, start: number, end: number) => buf.subarray(start, end).toString("latin1");

export function sniffMime(head: Buffer): Sniffed {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", inline: true };
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", inline: true };
  if (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a") return { mime: "image/gif", inline: true };
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return { mime: "image/webp", inline: true };
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return { mime: "video/webm", inline: true };
  if (ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    // vídeo do iPhone; se o navegador não abrir o codec, o chat mostra o download no lugar
    if (brand === "qt  ") return { mime: "video/quicktime", inline: true };
    if (brand === "M4A ") return { mime: "audio/mp4", inline: true }; // áudio do celular/iTunes
    return { mime: "video/mp4", inline: true };
  }
  // áudio (mp3, ogg, wav, flac) toca no próprio chat; webm e m4a já caíram nos casos acima
  const audio = audioMime(head);
  if (audio) return { mime: audio, inline: true };
  return { mime: "application/octet-stream", inline: false };
}

/** Nome seguro para exibir/baixar: sem caminho, sem caracteres de controle, tamanho limitado. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").trim().replace(/^\.+/, "");
  if (!clean) return "arquivo";
  if (clean.length <= 120) return clean;
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : "";
  return clean.slice(0, 120 - ext.length) + ext;
}
