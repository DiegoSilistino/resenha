import { youTubeWatchUrl } from "@resenha/shared";

export type TitleLookup =
  | { ok: true; title: string | null }
  | { ok: false; reason: "not_embeddable" | "not_found" };

export type TitleFetcher = (videoId: string) => Promise<TitleLookup>;

/**
 * Busca o título pelo oEmbed público do YouTube (não precisa de chave de API).
 * O oEmbed responde 401/403 quando o dono proibiu incorporar o vídeo: barramos já
 * na hora de adicionar, em vez de travar a fila de todo mundo depois.
 * Se o YouTube não responder, seguimos sem título.
 */
export function createOEmbedFetcher(fetchImpl: typeof fetch = fetch): TitleFetcher {
  return async (videoId) => {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youTubeWatchUrl(videoId))}`;
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(5_000) });
      if (res.status === 401 || res.status === 403) return { ok: false, reason: "not_embeddable" };
      if (res.status === 400 || res.status === 404) return { ok: false, reason: "not_found" };
      if (!res.ok) return { ok: true, title: null };
      const body = (await res.json()) as { title?: unknown };
      const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
      return { ok: true, title: title || null };
    } catch {
      return { ok: true, title: null };
    }
  };
}
