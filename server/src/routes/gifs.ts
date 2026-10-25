import type { FastifyInstance } from "fastify";
import { gifSearchQuery } from "@resenha/shared";
import { rateLimited, requireUser, type AppContext } from "../app.ts";
import { HttpError, parse } from "../http.ts";

export function registerGifRoutes(app: FastifyInstance, ctx: AppContext) {
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
