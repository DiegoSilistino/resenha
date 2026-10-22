import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createInviteBody, WS_CLOSE_SESSION_REVOKED } from "@resenha/shared";
import { requireAdmin, type AppContext } from "../app.ts";
import { badRequest, currentUser, notFound, parse } from "../http.ts";
import { toPublicUser } from "../store.ts";

const roleBody = z.object({ role: z.enum(["admin", "member"]) });

export const inviteUrl = (ctx: AppContext, code: string) => `${ctx.config.publicUrl}/convite/${code}`;

export const newInviteCode = () => randomBytes(12).toString("base64url");

export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, hub, voice, gateway } = ctx;

  app.get("/api/admin/invites", { preHandler: requireAdmin }, async () => ({
    invites: store.listInvites().map((invite) => ({ ...invite, url: inviteUrl(ctx, invite.code) })),
  }));

  app.post("/api/admin/invites", { preHandler: requireAdmin }, async (req, reply) => {
    const body = parse(createInviteBody, req.body ?? {});
    const invite = store.createInvite({
      code: newInviteCode(),
      role: body.role,
      maxUses: body.maxUses,
      expiresAt: body.expiresInHours === null ? null : Date.now() + body.expiresInHours * 3_600_000,
      createdBy: currentUser(req).id,
    });
    return reply.status(201).send({ invite: { ...invite, url: inviteUrl(ctx, invite.code) } });
  });

  app.delete<{ Params: { code: string } }>(
    "/api/admin/invites/:code",
    { preHandler: requireAdmin },
    async (req, reply) => {
      if (!store.revokeInvite(req.params.code)) throw notFound("Convite não encontrado");
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/admin/users/:id/disable",
    { preHandler: requireAdmin },
    async (req) => {
      if (req.params.id === currentUser(req).id) throw badRequest("Você não pode desativar a própria conta");
      const user = store.setUserDisabled(req.params.id, true);
      if (!user) throw notFound("Usuário não encontrado");

      const revoked = new Set(store.deleteUserSessions(user.id));
      hub.closeWhere(
        (c) => c.userId === user.id || revoked.has(c.tokenHash),
        WS_CLOSE_SESSION_REVOKED,
        "conta desativada",
      );
      const channelId = voice.channelOf(user.id);
      if (channelId) {
        voice.leave(user.id);
        await gateway.kick(user.id, channelId);
      }
      const pub = toPublicUser(user);
      hub.broadcast({ type: "user.upsert", user: pub });
      return { user: pub };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/admin/users/:id/enable",
    { preHandler: requireAdmin },
    async (req) => {
      const user = store.setUserDisabled(req.params.id, false);
      if (!user) throw notFound("Usuário não encontrado");
      const pub = toPublicUser(user);
      hub.broadcast({ type: "user.upsert", user: pub });
      return { user: pub };
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/admin/users/:id/role",
    { preHandler: requireAdmin },
    async (req) => {
      const { role } = parse(roleBody, req.body);
      if (req.params.id === currentUser(req).id && role !== "admin") {
        throw badRequest("Você não pode remover o próprio acesso de administrador");
      }
      const user = store.setUserRole(req.params.id, role);
      if (!user) throw notFound("Usuário não encontrado");
      const pub = toPublicUser(user);
      hub.broadcast({ type: "user.upsert", user: pub });
      return { user: pub };
    },
  );
}
