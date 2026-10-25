/**
 * Busca de GIFs no GIPHY, feita pelo servidor: a chave nunca vai para o navegador.
 *
 * A chave grátis permite 100 chamadas por hora para o grupo inteiro, então tudo passa
 * por um cache (as mesmas buscas e os "em alta" se repetem muito).
 */
import type { GifResult } from "@resenha/shared";
import { HttpError } from "../http.ts";

export interface GifProvider {
  trending(offset: number): Promise<GifResult[]>;
  search(query: string, offset: number): Promise<GifResult[]>;
}

const PAGE = 24;
const SEARCH_TTL_MS = 60 * 60 * 1000;
const TRENDING_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 300;
/** Só GIFs para todos os públicos e adolescentes (sem conteúdo adulto). */
const RATING = "pg-13";

interface GiphyRendition {
  url?: string;
  mp4?: string;
  webp?: string;
  width?: string;
  height?: string;
}

interface GiphyGif {
  id: string;
  title?: string;
  alt_text?: string;
  images?: Record<string, GiphyRendition | undefined>;
}

/** Converte a resposta do GIPHY no formato do app, descartando o que vier incompleto. */
export function toGifResults(data: unknown): GifResult[] {
  const list = (data as { data?: GiphyGif[] } | null)?.data;
  if (!Array.isArray(list)) return [];
  const out: GifResult[] = [];
  for (const g of list) {
    const img = g.images ?? {};
    const original = img.original;
    const mp4 = original?.mp4 ?? img.fixed_width?.mp4;
    const preview = img.fixed_width_downsampled?.webp ?? img.fixed_width?.webp ?? img.fixed_width?.url;
    const width = Number(original?.width ?? img.fixed_width?.width);
    const height = Number(original?.height ?? img.fixed_width?.height);
    if (!g.id || !mp4 || !preview || !(width > 0) || !(height > 0)) continue;
    if (!isGiphyMediaUrl(mp4) || !isGiphyMediaUrl(preview)) continue;
    out.push({ id: g.id, title: (g.alt_text || g.title || "GIF").slice(0, 120), previewUrl: preview, mp4Url: mp4, width, height });
  }
  return out;
}

/** Só mídia dos servidores do GIPHY entra no app (é o que a CSP permite exibir). */
export function isGiphyMediaUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /^(media\d*|i)\.giphy\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

export function createGiphy(opts: { apiKey: string; baseUrl: string; fetch?: typeof fetch; now?: () => number }): GifProvider {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; ttl: number; results: GifResult[] }>();

  async function call(path: string, params: Record<string, string>, ttl: number): Promise<GifResult[]> {
    const key = `${path}?${new URLSearchParams(params)}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < hit.ttl) return hit.results;

    const url = new URL(path, opts.baseUrl);
    for (const [k, v] of Object.entries({ ...params, api_key: opts.apiKey, limit: String(PAGE), rating: RATING })) {
      url.searchParams.set(k, v);
    }
    let res: Response;
    try {
      res = await doFetch(url, { signal: AbortSignal.timeout(6_000) });
    } catch {
      throw new HttpError(502, "Não consegui falar com o GIPHY agora. Tente de novo em instantes.");
    }
    if (res.status === 429) {
      throw new HttpError(429, "Acabaram as buscas de GIF desta hora (o GIPHY grátis permite 100 por hora). Tente daqui a pouco.");
    }
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(502, "O GIPHY recusou a chave. Quem administra: confira GIPHY_API_KEY no .env.");
    }
    if (!res.ok) throw new HttpError(502, `O GIPHY respondeu com erro ${res.status}.`);
    const results = toGifResults(await res.json().catch(() => null));

    cache.set(key, { at: now(), ttl, results });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!); // a mais antiga
    return results;
  }

  return {
    trending: (offset) => call("/v1/gifs/trending", { offset: String(offset) }, TRENDING_TTL_MS),
    search: (query, offset) =>
      call("/v1/gifs/search", { q: query.toLowerCase(), offset: String(offset), lang: "pt" }, SEARCH_TTL_MS),
  };
}
