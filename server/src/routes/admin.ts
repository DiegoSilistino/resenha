import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createInviteBody, WS_CLOSE_SESSION_REVOKED } from "@resenha/shared";
import { requireAdmin, type AppContext } from "../app.ts";
import { badRequest, currentUser, notFound, parse } from "../http.ts";
import { toPublicUser } from "../store.ts";
import { publishUser } from "../realtime/socket.ts";

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
    if (body.rodaId && !store.rodaById(body.rodaId)) throw badRequest("Roda não encontrada");
    const invite = store.createInvite({
      rodaId: body.rodaId ?? null,
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

  /** Derruba todas as sessões da pessoa, o WebSocket e a voz, na hora. */
  async function disconnectEverywhere(userId: string, reason: string) {
    const revoked = new Set(store.deleteUserSessions(userId));
    hub.closeWhere((c) => c.userId === userId || revoked.has(c.tokenHash), WS_CLOSE_SESSION_REVOKED, reason);
    const channelId = voice.channelOf(userId);
    if (channelId) {
      voice.leave(userId);
      await gateway.kick(userId, channelId);
    }
  }

  /** Conta que pode ser alterada pelo admin (existe e não foi removida). */
  function manageableUser(id: string) {
    const user = store.userById(id);
    if (!user || user.removed) throw notFound("Usuário não encontrado");
    return user;
  }

  // Todas as contas, só para o painel de Membros: no resto do app o admin também só vê quem conhece.
  app.get("/api/admin/users", { preHandler: requireAdmin }, async () => ({
    users: store
      .listUsers()
      .filter((u) => !u.removed)
      .map((u) => ({ ...toPublicUser(u), twoFactor: !!store.accountSecrets(u.id).totpSecret })),
  }));

  // Perdeu o celular e os códigos de reserva: o admin desliga a verificação e a pessoa entra só com a senha.
  app.post<{ Params: { id: string } }>("/api/admin/users/:id/2fa/disable", { preHandler: requireAdmin }, async (req, reply) => {
    store.disableTotp(manageableUser(req.params.id).id);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>(
    "/api/admin/users/:id/disable",
    { preHandler: requireAdmin },
    async (req) => {
      if (req.params.id === currentUser(req).id) throw badRequest("Você não pode desativar a própria conta");
      manageableUser(req.params.id);
      const user = store.setUserDisabled(req.params.id, true)!;
      await disconnectEverywhere(user.id, "conta desativada");
      const pub = toPublicUser(user);
      publishUser(ctx, pub);
      return { user: pub };
    },
  );

  // Remover de vez (ex.: conta duplicada). As mensagens ficam, assinadas como "Ex-membro".
  app.delete<{ Params: { id: string } }>(
    "/api/admin/users/:id",
    { preHandler: requireAdmin },
    async (req, reply) => {
      if (req.params.id === currentUser(req).id) throw badRequest("Você não pode remover a própria conta");
      manageableUser(req.params.id);
      const friendIds = store.listFriends(req.params.id).map((f) => f.userId);
      // quem conhecia a pessoa, guardado antes: removida, ela não tem mais amizade nem roda com ninguém
      const audience = store.relatedUserIds(req.params.id);
      const removed = store.removeUser(req.params.id);
      if (!removed) throw notFound("Usuário não encontrado");
      for (const id of friendIds) hub.sendToUser(id, { type: "friend.remove", userId: removed.user.id });
      await disconnectEverywhere(removed.user.id, "conta removida");
      const images = [removed.avatarId, removed.bannerId].filter((id): id is string => !!id);
      if (images.length) await ctx.avatars.remove(images);
      if (removed.orphanAttachmentIds.length) await ctx.uploads.remove(removed.orphanAttachmentIds);
      hub.sendToUsers(audience, { type: "user.upsert", user: toPublicUser(removed.user) });
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/admin/users/:id/enable",
    { preHandler: requireAdmin },
    async (req) => {
      manageableUser(req.params.id);
      const user = store.setUserDisabled(req.params.id, false);
      if (!user) throw notFound("Usuário não encontrado");
      const pub = toPublicUser(user);
      publishUser(ctx, pub);
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
      manageableUser(req.params.id);
      const user = store.setUserRole(req.params.id, role);
      if (!user) throw notFound("Usuário não encontrado");
      const pub = toPublicUser(user);
      publishUser(ctx, pub);
      return { user: pub };
    },
  );
}
