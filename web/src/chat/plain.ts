import type { GifResult } from "@resenha/shared";

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

/** Figurinha do caramelo: a mensagem é só "[figurinha:<id>]", que o seletor manda. */
const STICKER = /^\[figurinha:([a-z0-9-]+)\]$/;
export const stickerMessage = (id: string) => `[figurinha:${id}]`;
export function parseStickerMessage(content: string): string | null {
  return STICKER.exec(content.trim())?.[1] ?? null;
}

/**
 * GIF da conversa como item dos favoritos. O id do GIPHY sai do link (/media/<id>/giphy.mp4), o
 * mesmo que o seletor usa: favoritar aqui ou lá marca o mesmo GIF.
 */
export function gifFromMessage(content: string): GifResult | null {
  const gif = parseGifMessage(content);
  if (!gif) return null;
  const url = new URL(gif.src);
  const parts = url.pathname.split("/");
  const id = parts.at(-2);
  if (!id || parts.length < 3) return null;
  const base = `${url.origin}${parts.slice(0, -1).join("/")}/`;
  // shortcut: a capa (200.webp) é o nome padrão do GIPHY, não vem na mensagem; se faltar, escolher como capa avisa o erro
  return { id, title: "GIF", previewUrl: gif.src, mp4Url: gif.src, imageUrl: `${base}200.webp`, width: gif.width, height: gif.height };
}

/** Códigos dos links de convite de roda deste servidor numa mensagem (sem repetir, no máximo 3). */
export function inviteCodes(content: string, origin = location.origin): string[] {
  const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const codes = [...content.matchAll(new RegExp(`${escaped}/convite/([A-Za-z0-9_-]+)`, "g"))].map((m) => m[1]!);
  return [...new Set(codes)].slice(0, 3);
}

export function plainText(content: string): string {
  if (parseGifMessage(content)) return "GIF";
  if (parseStickerMessage(content)) return "Figurinha";
  return content
    .replace(/```[a-z0-9]*\n?([\s\S]*?)```/gi, "$1")
    .replace(/\|\|[^|\n]+?\|\|/g, "▒▒▒▒")
    .replace(/(\*\*|~~|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
