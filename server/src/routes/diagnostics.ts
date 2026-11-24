import type { FastifyInstance, FastifyRequest } from "fastify";
import { clientErrorBody } from "@resenha/shared";
import { rateLimited, requireAdmin, requireUser, type AppContext } from "../app.ts";
import { currentUser, forbidden, parse } from "../http.ts";

/**
 * Painel de erros: o navegador de cada um reporta falhas (voz, microfone, tela, IA, erros
 * inesperados) e o admin vê tudo num lugar, sem depender de print.
 */
export function registerDiagnosticsRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, hub } = ctx;

  app.post(
    "/api/client-errors",
    { preHandler: requireUser, config: rateLimited(ctx, 20, "10 minutes") },
    async (req, reply) => {
      const body = parse(clientErrorBody, req.body);
      const entry = store.insertClientError({
        userId: currentUser(req).id,
        kind: body.kind,
        message: body.message,
        detail: body.detail,
        userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300),
        context: body.context,
      });
      if (entry.kind === "feedback") {
        const owner = store.siteOwnerId();
        if (owner) hub.sendToUser(owner, { type: "admin.feedback", entry });
      } else {
        hub.sendWhere((userId) => store.userById(userId)?.role === "admin", { type: "admin.error", entry });
      }
      return reply.status(204).send();
    },
  );

  app.get("/api/admin/errors", { preHandler: requireAdmin }, async () => ({ errors: store.listClientErrors() }));

  app.delete("/api/admin/errors", { preHandler: requireAdmin }, async (_req, reply) => {
    store.clearClientErrors();
    return reply.status(204).send();
  });

  // Feedback da tela inicial: canal só do criador do site, mesmo que existam outros admins.
  const ownerOnly = (req: FastifyRequest) => {
    if (currentUser(req).id !== store.siteOwnerId()) throw forbidden("Só quem criou o site vê o feedback");
  };

  app.get("/api/admin/feedback", { preHandler: requireUser }, async (req) => {
    ownerOnly(req);
    return { feedback: store.listClientErrors(200, true) };
  });

  app.delete("/api/admin/feedback", { preHandler: requireUser }, async (req, reply) => {
    ownerOnly(req);
    store.clearClientErrors(true);
    return reply.status(204).send();
  });
}
