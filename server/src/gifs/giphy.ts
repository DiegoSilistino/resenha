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
  /** Baixa uma mídia do GIPHY (a capa do perfil), sem passar de maxBytes. */
  download(url: string, maxBytes: number): Promise<Buffer>;
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
    // capa do perfil: 200 px de altura cobre bem os 120 px do cartão, com todos os quadros
    const image = img.fixed_height?.webp ?? img.fixed_width?.webp ?? preview;
    const width = Number(original?.width ?? img.fixed_width?.width);
    const height = Number(original?.height ?? img.fixed_width?.height);
    if (!g.id || !mp4 || !preview || !image || !(width > 0) || !(height > 0)) continue;
    if (!isGiphyMediaUrl(mp4) || !isGiphyMediaUrl(preview) || !isGiphyMediaUrl(image)) continue;
    out.push({ id: g.id, title: (g.alt_text || g.title || "GIF").slice(0, 120), previewUrl: preview, mp4Url: mp4, imageUrl: image, width, height });
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

  async function download(url: string, maxBytes: number): Promise<Buffer> {
    if (!isGiphyMediaUrl(url)) throw new HttpError(400, "Escolha um GIF do seletor.");
    const unreachable = () => new HttpError(502, "Não consegui baixar o GIF do GIPHY agora. Tente de novo em instantes.");
    const tooBig = () => new HttpError(413, `Esse GIF passa de ${maxBytes / 1024 / 1024} MB; escolha outro.`);
    let res: Response;
    try {
      // sem seguir redirecionamento: o servidor só busca o que é do GIPHY
      res = await doFetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    } catch {
      throw unreachable();
    }
    if (!res.ok || !res.body) throw new HttpError(502, `O GIPHY respondeu com erro ${res.status}.`);
    if (Number(res.headers.get("content-length")) > maxBytes) throw tooBig();
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (let r = await reader.read(); !r.done; r = await reader.read()) {
        size += r.value.byteLength;
        if (size > maxBytes) break;
        chunks.push(r.value);
      }
    } catch {
      throw unreachable();
    }
    if (size > maxBytes) {
      void reader.cancel().catch(() => {});
      throw tooBig();
    }
    return Buffer.concat(chunks);
  }

  return {
    trending: (offset) => call("/v1/gifs/trending", { offset: String(offset) }, TRENDING_TTL_MS),
    search: (query, offset) =>
      call("/v1/gifs/search", { q: query.toLowerCase(), offset: String(offset), lang: "pt" }, SEARCH_TTL_MS),
    download,
  };
}
