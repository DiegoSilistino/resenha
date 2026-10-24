import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { rateLimited, requireAdmin, type AppContext } from "../app.ts";
import { forbidden } from "../http.ts";

/**
 * O download é um GET (o navegador baixa direto, com barra de progresso), então o cookie
 * iria junto num link vindo de outro site. Sec-Fetch-Site barra esse caso: o atacante não
 * leria nada, mas poderia fazer o "último backup" parecer recente.
 */
function assertSameSiteNavigation(req: FastifyRequest) {
  const site = req.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") {
    throw forbidden("Abra o backup pelo próprio app.");
  }
}

export function registerBackupRoutes(app: FastifyInstance, ctx: AppContext) {
  const { backups } = ctx;

  app.get("/api/admin/backup/info", { preHandler: requireAdmin }, async () => backups.info());

  app.get(
    "/api/admin/backup",
    { preHandler: requireAdmin, config: rateLimited(ctx, 6, "1 hour") },
    async (req, reply) => {
      assertSameSiteNavigation(req);
      const { filename, stream } = backups.archive();
      req.log.info({ admin: req.auth?.user.username }, "download do backup completo");
      return reply
        .header("Content-Type", "application/x-tar")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .send(Readable.from(stream, { objectMode: false }));
    },
  );
}
