import type { FastifyInstance } from "fastify";
import { LIMITS, searchQuery } from "@resenha/shared";
import { rateLimited, requireUser, type AppContext } from "../app.ts";
import { currentUser, parse } from "../http.ts";
import { searchTerms } from "../search.ts";

export function registerSearchRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/search", { preHandler: requireUser, config: rateLimited(ctx, 40, "1 minute") }, async (req) => {
    const q = parse(searchQuery, req.query);
    const userId = currentUser(req).id;
    if (q.channelId && !ctx.store.canAccess(userId, q.channelId)) return { results: [], hasMore: false };
    const results = ctx.store.search({
      terms: searchTerms(q.q),
      userId,
      limit: LIMITS.searchPageSize,
      ...(q.channelId ? { channelId: q.channelId } : {}),
      ...(q.before ? { before: q.before } : {}),
    });
    return { results, hasMore: results.length === LIMITS.searchPageSize };
  });
}
