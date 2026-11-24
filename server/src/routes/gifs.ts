import type { FastifyInstance } from "fastify";
import { gifSearchQuery, type GifCategories, type GifResult } from "@resenha/shared";
import { rateLimited, requireUser, type AppContext } from "../app.ts";
import { HttpError, parse } from "../http.ts";

/** Atalhos da tela inicial do seletor (como no Discord): cada um mostra o 1º GIF da busca. */
export const GIF_CATEGORY_TERMS = ["oi", "kkkk", "amor", "parabéns", "sextou", "triste", "obrigado", "dança", "uau", "tchau"];

export function registerGifRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get(
    "/api/gifs/categories",
    { preHandler: requireUser, config: rateLimited(ctx, 40, "1 minute") },
    async (): Promise<GifCategories> => {
      const gifs = ctx.gifs;
      if (!gifs) throw new HttpError(404, "GIFs não estão configurados neste servidor");
      // as mesmas buscas de sempre, que ficam em cache: abrir o seletor não gasta o limite do GIPHY toda vez
      const [trending, ...terms] = await Promise.allSettled([
        gifs.trending(0),
        ...GIF_CATEGORY_TERMS.map((term) => gifs.search(term, 0)),
      ]);
      const first = (r: PromiseSettledResult<GifResult[]> | undefined) => (r?.status === "fulfilled" ? (r.value[0] ?? null) : null);
      return { trending: first(trending), categories: GIF_CATEGORY_TERMS.map((term, i) => ({ term, gif: first(terms[i]) })) };
    },
  );

  app.get(
    "/api/gifs",
    { preHandler: requireUser, config: rateLimited(ctx, 40, "1 minute") },
    async (req) => {
      const gifs = ctx.gifs;
      if (!gifs) throw new HttpError(404, "GIFs não estão configurados neste servidor");
      const { q, offset } = parse(gifSearchQuery, req.query);
      return { gifs: q ? await gifs.search(q, offset) : await gifs.trending(offset) };
    },
  );
}
