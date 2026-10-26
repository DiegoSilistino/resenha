/** Tipo real de um arquivo de áudio pelos primeiros bytes (o nome e o navegador podem mentir). */
const ascii = (buf: Buffer, start: number, end: number) => buf.subarray(start, end).toString("latin1");

export function audioMime(head: Buffer): string | null {
  if (head.length < 12) return null;
  if (ascii(head, 0, 3) === "ID3") return "audio/mpeg";
  // quadro MPEG sem cabeçalho ID3: 11 bits de sincronia, camada III
  if (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0 && (head[1]! & 0x06) === 0x02) return "audio/mpeg";
  if (ascii(head, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WAVE") return "audio/wav";
  if (ascii(head, 0, 4) === "fLaC") return "audio/flac";
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "audio/webm";
  if (ascii(head, 4, 8) === "ftyp") return "audio/mp4"; // .m4a
  return null;
}
