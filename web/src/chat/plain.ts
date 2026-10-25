/**
 * Texto puro de uma mensagem, para citações de resposta e notificações: sem marcação,
 * com spoiler escondido e GIF descrito (nunca a URL crua).
 */
export const GIF_URL = /^https:\/\/(?:media\d*|i)\.giphy\.com\/\S+\.mp4(?:\?\S*)?(?:#\d+x\d+)?$/i;

/** A mensagem é só um GIF (o seletor manda a URL do MP4 com as dimensões no "#"). */
export function parseGifMessage(content: string): { src: string; width: number; height: number } | null {
  const text = content.trim();
  if (!GIF_URL.test(text)) return null;
  const [src, size] = text.split("#");
  const [w, h] = (size ?? "").split("x").map(Number);
  return { src: src!, width: w && w > 0 ? w : 480, height: h && h > 0 ? h : 270 };
}

export function plainText(content: string): string {
  if (parseGifMessage(content)) return "GIF";
  return content
    .replace(/```[a-z0-9]*\n?([\s\S]*?)```/gi, "$1")
    .replace(/\|\|[^|\n]+?\|\|/g, "▒▒▒▒")
    .replace(/(\*\*|~~|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
