import type { FastifyInstance } from "fastify";
import { reportBody } from "@resenha/shared";
import { rateLimited, requireAdmin, requireUser, type AppContext } from "../app.ts";
import { currentUser, notFound, parse } from "../http.ts";

/** Denúncias: qualquer um denuncia uma mensagem ou uma pessoa; os administradores veem e resolvem. */
export function registerReportRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, hub } = ctx;
  const notifyAdmins = () =>
    hub.sendWhere((userId) => store.userById(userId)?.role === "admin", { type: "admin.reports", open: store.openReportCount() });

  app.post("/api/reports", { preHandler: requireUser, config: rateLimited(ctx, 10, "10 minutes") }, async (req, reply) => {
    const me = currentUser(req);
    const body = parse(reportBody, req.body);
    const target = store.userById(body.userId);
    if (!target || target.removed || target.id === me.id) throw notFound("Pessoa não encontrada");
    let content = "";
    let channelId: string | null = null;
    if (body.messageId !== undefined) {
      const m = store.messageById(body.messageId);
      // só se denuncia o que se consegue ver, e a mensagem tem de ser de quem está sendo denunciado
      if (!m || m.authorId !== target.id || !store.canAccess(me.id, m.channelId)) throw notFound("Mensagem não encontrada");
      content = m.content;
      channelId = m.channelId;
    }
    store.insertReport({ reporterId: me.id, targetUserId: target.id, messageId: body.messageId ?? null, channelId, content, reason: body.reason });
    notifyAdmins();
    return reply.status(204).send();
  });

  app.get("/api/admin/reports", { preHandler: requireAdmin }, async () => ({ reports: store.listReports() }));

  app.post<{ Params: { id: string } }>("/api/admin/reports/:id/done", { preHandler: requireAdmin }, async (req) => {
    const report = store.markReportDone(Number(req.params.id));
    if (!report) throw notFound("Denúncia não encontrada ou já resolvida");
    notifyAdmins();
    return { report };
  });

  // Apaga a mensagem denunciada, mesmo numa conversa privada em que o admin não está.
  app.delete<{ Params: { id: string } }>("/api/admin/reports/:id/message", { preHandler: requireAdmin }, async (req, reply) => {
    const report = store.reportById(Number(req.params.id));
    const message = report?.messageId ? store.messageById(report.messageId) : null;
    if (!message) throw notFound("A mensagem já foi apagada");
    await ctx.uploads.remove(store.deleteMessage(message.id));
    hub.publish(store.channelAudience(message.channelId), { type: "message.delete", channelId: message.channelId, messageId: message.id });
    return reply.status(204).send();
  });
}
