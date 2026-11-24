import type { FastifyInstance } from "fastify";
import {
  bannerGifBody,
  createChannelBody,
  createRodaBody,
  LIMITS,
  memberRoleBody,
  reorderChannelsBody,
  roleBody,
  rodaInviteBody,
  transferOwnerBody,
  updateRodaBody,
  type Invite,
  type Permission,
  type Roda,
} from "@resenha/shared";
import { rateLimited, requireUser, type AppContext } from "../app.ts";
import { badRequest, currentUser, forbidden, notFound, parse } from "../http.ts";
import { buildHello } from "../realtime/socket.ts";
import { toRodaSummary, type UserRecord } from "../store.ts";
import { inviteUrl, newInviteCode } from "./admin.ts";
import { readBannerUpload, receiveAvatar, writeBanner } from "./avatars.ts";
import { isInviteUsable } from "./auth.ts";

/** Cores das rodas novas (matiz): sorteia uma para cada. */
const RODA_HUES = [40, 85, 125, 160, 215, 260, 305, 350];

/** Manda o estado completo de novo para quem entrou, saiu ou mudou de cargo (as salas visíveis mudam). */
export function resync(ctx: AppContext, userIds: Iterable<string>) {
  for (const id of new Set(userIds)) {
    const user = ctx.store.userById(id);
    if (user) ctx.hub.sendToUser(id, buildHello(ctx, user));
  }
}

/**
 * Avisa quem faz parte que a roda mudou (membros, cargos, pedidos, nome). Se ela é aberta,
 * todo mundo fica sabendo também (a lista "Abertas para entrar" se atualiza sozinha).
 */
export function publishRoda(ctx: AppContext, rodaId: string) {
  const roda = ctx.store.rodaById(rodaId);
  if (!roda) return;
  ctx.hub.sendToUsers(Object.keys(roda.members), { type: "roda.upsert", roda });
  if (roda.privacy === "aberta") ctx.hub.broadcast({ type: "roda.open", roda: toRodaSummary(roda) });
}

/**
 * Entrar na roda pelo convite: direto ou, se o convite pede aprovação, como pedido.
 * Quem chama já consumiu (ou vai consumir) um uso do convite.
 */
export function joinViaInvite(ctx: AppContext, user: UserRecord, invite: Invite): "joined" | "requested" | "already" {
  const { store } = ctx;
  if (!invite.rodaId || !store.rodaById(invite.rodaId)) return "already";
  if (store.memberRole(invite.rodaId, user.id)) return "already";
  if (invite.approval) {
    store.addRequest(invite.rodaId, user.id);
    publishRoda(ctx, invite.rodaId);
    return "requested";
  }
  store.addMember(invite.rodaId, user.id, user.role === "admin");
  publishRoda(ctx, invite.rodaId);
  resync(ctx, [user.id]);
  return "joined";
}

export function registerRodaRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, hub, voice, watch, gateway, uploads } = ctx;

  /** A roda, se a pessoa faz parte (senão, para ela, não existe). */
  const rodaFor = (id: string, user: UserRecord): Roda => {
    const roda = store.rodaById(id);
    if (!roda || !(user.id in roda.members)) throw notFound("Roda não encontrada");
    return roda;
  };

  const need = (user: UserRecord, rodaId: string, perm: Permission, msg: string) => {
    if (!store.permsOf(user, rodaId).has(perm)) throw forbidden(msg);
  };

  const ownerOnly = (user: UserRecord, rodaId: string) => {
    if (!store.memberRole(rodaId, user.id)?.owner && user.role !== "admin") {
      throw forbidden("Só o dono da roda pode fazer isso");
    }
  };

  /** Tira alguém de todas as chamadas da roda (saiu, foi expulso, a roda acabou). */
  const dropFromCalls = async (rodaId: string, userId: string) => {
    for (const c of store.listChannels(rodaId)) {
      if (voice.isIn(userId, c.id)) await gateway.kick(userId, c.id);
    }
  };

  const leave = async (rodaId: string, userId: string) => {
    await dropFromCalls(rodaId, userId);
    store.removeMember(rodaId, userId);
    publishRoda(ctx, rodaId);
    resync(ctx, [userId]);
  };

  // ---------- a roda ----------

  app.post("/api/rodas", { preHandler: requireUser, config: rateLimited(ctx, 10, "10 minutes") }, async (req, reply) => {
    const body = parse(createRodaBody, req.body);
    const hue = RODA_HUES[Math.floor(Math.random() * RODA_HUES.length)]!;
    const roda = store.createRoda({ name: body.name, description: body.description, privacy: body.privacy, hue }, currentUser(req).id, body.template);
    resync(ctx, [currentUser(req).id]);
    publishRoda(ctx, roda.id);
    return reply.status(201).send({ roda });
  });

  app.patch<{ Params: { id: string } }>("/api/rodas/:id", { preHandler: requireUser }, async (req) => {
    const user = currentUser(req);
    rodaFor(req.params.id, user);
    ownerOnly(user, req.params.id);
    const roda = store.updateRoda(req.params.id, parse(updateRodaBody, req.body))!;
    publishRoda(ctx, roda.id);
    if (roda.privacy === "privada") hub.broadcast({ type: "roda.closed", rodaId: roda.id });
    return { roda };
  });

  app.delete<{ Params: { id: string } }>("/api/rodas/:id", { preHandler: requireUser }, async (req, reply) => {
    const user = currentUser(req);
    const roda = rodaFor(req.params.id, user);
    ownerOnly(user, roda.id);
    const members = Object.keys(roda.members);
    const { channelIds, attachmentIds, imageIds } = store.deleteRoda(roda.id);
    for (const id of channelIds) {
      const kicked = voice.clearChannel(id);
      watch.removeChannel(id);
      await Promise.all(kicked.map((userId) => gateway.kick(userId, id)));
    }
    await uploads.remove(attachmentIds);
    await ctx.avatars.remove(imageIds);
    resync(ctx, members);
    hub.broadcast({ type: "roda.closed", rodaId: roda.id });
    return reply.status(204).send();
  });

  // ---------- capa e foto (só o dono, como o resto da aba Geral) ----------

  /** Troca a capa ou a foto, apaga a anterior do disco e avisa quem está na roda. */
  const replaceImage = async (rodaId: string, kind: "banner" | "icon", image: { id: string; mime: string } | null) => {
    const previous = store.setRodaImage(rodaId, kind, image);
    if (previous) await ctx.avatars.remove([previous]);
    publishRoda(ctx, rodaId);
    return { roda: store.rodaById(rodaId)! };
  };
  /** Confere antes de ler o arquivo: quem não pode nem chega a mandar os bytes para o disco. */
  const ownedRoda = (rodaId: string, user: UserRecord) => {
    rodaFor(rodaId, user);
    ownerOnly(user, rodaId);
  };

  app.post<{ Params: { id: string } }>(
    "/api/rodas/:id/banner",
    { preHandler: requireUser, config: rateLimited(ctx, 10, "10 minutes") },
    async (req) => {
      ownedRoda(req.params.id, currentUser(req));
      return replaceImage(req.params.id, "banner", await writeBanner(ctx, await readBannerUpload(req)));
    },
  );

  // GIF escolhido no seletor: o servidor baixa do GIPHY e guarda como se fosse enviado.
  app.post<{ Params: { id: string } }>(
    "/api/rodas/:id/banner/gif",
    { preHandler: requireUser, config: rateLimited(ctx, 10, "10 minutes") },
    async (req) => {
      if (!ctx.gifs) throw notFound();
      ownedRoda(req.params.id, currentUser(req));
      const { url } = parse(bannerGifBody, req.body);
      return replaceImage(req.params.id, "banner", await writeBanner(ctx, await ctx.gifs.download(url, LIMITS.bannerMaxBytes)));
    },
  );

  app.delete<{ Params: { id: string } }>("/api/rodas/:id/banner", { preHandler: requireUser }, async (req) => {
    ownedRoda(req.params.id, currentUser(req));
    return replaceImage(req.params.id, "banner", null);
  });

  // Foto da roda: as mesmas regras da foto de perfil (imagem parada, recortada no navegador).
  app.post<{ Params: { id: string } }>(
    "/api/rodas/:id/icon",
    { preHandler: requireUser, config: rateLimited(ctx, 10, "10 minutes") },
    async (req) => {
      ownedRoda(req.params.id, currentUser(req));
      return replaceImage(req.params.id, "icon", await receiveAvatar(req, ctx));
    },
  );

  app.delete<{ Params: { id: string } }>("/api/rodas/:id/icon", { preHandler: requireUser }, async (req) => {
    ownedRoda(req.params.id, currentUser(req));
    return replaceImage(req.params.id, "icon", null);
  });

  // Roda aberta: qualquer pessoa entra sem convite.
  app.post<{ Params: { id: string } }>("/api/rodas/:id/join", { preHandler: requireUser }, async (req, reply) => {
    const user = currentUser(req);
    const roda = store.rodaById(req.params.id);
    if (!roda || roda.privacy !== "aberta") throw notFound("Roda não encontrada");
    store.addMember(roda.id, user.id, user.role === "admin");
    publishRoda(ctx, roda.id);
    resync(ctx, [user.id]);
    return reply.status(204).send();
  });

  // ---------- membros ----------

  app.delete<{ Params: { id: string } }>("/api/rodas/:id/members/me", { preHandler: requireUser }, async (req, reply) => {
    const user = currentUser(req);
    rodaFor(req.params.id, user);
    if (store.memberRole(req.params.id, user.id)?.owner) {
      throw badRequest("O dono não sai da roda: apague a roda em Ajustes, se for o caso");
    }
    await leave(req.params.id, user.id);
    return reply.status(204).send();
  });

  app.delete<{ Params: { id: string; userId: string } }>(
    "/api/rodas/:id/members/:userId",
    { preHandler: requireUser },
    async (req, reply) => {
      const user = currentUser(req);
      const roda = rodaFor(req.params.id, user);
      need(user, roda.id, "expulsar", "Seu cargo não pode tirar pessoas da roda");
      const target = req.params.userId;
      if (!(target in roda.members)) throw notFound("Essa pessoa não está na roda");
      if (target === user.id) throw badRequest("Para sair, use Sair da roda");
      if (store.memberRole(roda.id, target)?.owner) throw forbidden("O dono não pode ser tirado da roda");
      await leave(roda.id, target);
      return reply.status(204).send();
    },
  );

  app.patch<{ Params: { id: string; userId: string } }>(
    "/api/rodas/:id/members/:userId",
    { preHandler: requireUser },
    async (req) => {
      const user = currentUser(req);
      const roda = rodaFor(req.params.id, user);
      ownerOnly(user, roda.id);
      const { roleId } = parse(memberRoleBody, req.body);
      if (store.memberRole(roda.id, req.params.userId)?.owner) throw forbidden("O cargo do dono não muda");
      if (!store.setMemberRole(roda.id, req.params.userId, roleId)) throw badRequest("Cargo inválido");
      publishRoda(ctx, roda.id);
      resync(ctx, [req.params.userId]);
      return { roda: store.rodaById(roda.id) };
    },
  );

  // Passar a posse: a pessoa vira Dono e quem era dono fica com o cargo que ela tinha.
  app.post<{ Params: { id: string } }>("/api/rodas/:id/owner", { preHandler: requireUser }, async (req) => {
    const user = currentUser(req);
    const roda = rodaFor(req.params.id, user);
    ownerOnly(user, roda.id);
    const { userId } = parse(transferOwnerBody, req.body);
    const previous = store.transferOwnership(roda.id, userId);
    if (previous === null) throw badRequest("Essa pessoa não está na roda ou já é a dona");
    publishRoda(ctx, roda.id);
    resync(ctx, [userId, previous].filter(Boolean));
    return { roda: store.rodaById(roda.id) };
  });

  // ---------- cargos ----------

  app.post<{ Params: { id: string } }>("/api/rodas/:id/roles", { preHandler: requireUser }, async (req, reply) => {
    const user = currentUser(req);
    rodaFor(req.params.id, user);
    ownerOnly(user, req.params.id);
    const role = store.createRole(req.params.id, parse(roleBody, req.body));
    publishRoda(ctx, req.params.id);
    return reply.status(201).send({ role });
  });

  app.patch<{ Params: { id: string; roleId: string } }>("/api/rodas/:id/roles/:roleId", { preHandler: requireUser }, async (req) => {
    const user = currentUser(req);
    const roda = rodaFor(req.params.id, user);
    ownerOnly(user, roda.id);
    const role = store.roleById(req.params.roleId);
    if (!role || role.rodaId !== roda.id) throw notFound("Cargo não encontrado");
    store.updateRole(role.id, parse(roleBody, req.body));
    publishRoda(ctx, roda.id);
    // os poderes mudaram: quem tem o cargo pode passar a ver (ou deixar de ver) salas
    resync(ctx, Object.entries(roda.members).filter(([, r]) => r === role.id).map(([u]) => u));
    return { roda: store.rodaById(roda.id) };
  });

  app.delete<{ Params: { id: string; roleId: string } }>(
    "/api/rodas/:id/roles/:roleId",
    { preHandler: requireUser },
    async (req, reply) => {
      const user = currentUser(req);
      const roda = rodaFor(req.params.id, user);
      ownerOnly(user, roda.id);
      const role = store.roleById(req.params.roleId);
      if (!role || role.rodaId !== roda.id) throw notFound("Cargo não encontrado");
      if (!store.deleteRole(role.id)) throw badRequest("O cargo de dono e o cargo de quem entra não podem ser apagados");
      publishRoda(ctx, roda.id);
      resync(ctx, Object.entries(roda.members).filter(([, r]) => r === role.id).map(([u]) => u));
      return reply.status(204).send();
    },
  );

  // ---------- convites e pedidos ----------

  const withUrl = (invite: Invite) => ({ ...invite, url: inviteUrl(ctx, invite.code) });

  app.get<{ Params: { id: string } }>("/api/rodas/:id/invites", { preHandler: requireUser }, async (req) => {
    const user = currentUser(req);
    rodaFor(req.params.id, user);
    need(user, req.params.id, "convidar", "Seu cargo não pode convidar");
    return { invites: store.listRodaInvites(req.params.id).map(withUrl) };
  });

  app.post<{ Params: { id: string } }>(
    "/api/rodas/:id/invites",
    { preHandler: requireUser, config: rateLimited(ctx, 20, "10 minutes") },
    async (req, reply) => {
      const user = currentUser(req);
      rodaFor(req.params.id, user);
      need(user, req.params.id, "convidar", "Seu cargo não pode convidar");
      const body = parse(rodaInviteBody, req.body ?? {});
      const invite = store.createInvite({
        code: newInviteCode(),
        role: "member",
        maxUses: body.maxUses,
        expiresAt: body.expiresInMinutes === null ? null : Date.now() + body.expiresInMinutes * 60_000,
        createdBy: user.id,
        rodaId: req.params.id,
        approval: body.approval,
      });
      return reply.status(201).send({ invite: withUrl(invite) });
    },
  );

  app.delete<{ Params: { id: string; code: string } }>(
    "/api/rodas/:id/invites/:code",
    { preHandler: requireUser },
    async (req, reply) => {
      const user = currentUser(req);
      rodaFor(req.params.id, user);
      need(user, req.params.id, "convidar", "Seu cargo não pode mexer nos convites");
      if (store.inviteByCode(req.params.code)?.rodaId !== req.params.id || !store.revokeInvite(req.params.code)) {
        throw notFound("Convite não encontrado");
      }
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string; userId: string } }>(
    "/api/rodas/:id/requests/:userId/approve",
    { preHandler: requireUser },
    async (req, reply) => {
      const user = currentUser(req);
      const roda = rodaFor(req.params.id, user);
      need(user, roda.id, "convidar", "Seu cargo não pode aprovar pedidos");
      const target = store.userById(req.params.userId);
      if (!roda.requests.includes(req.params.userId) || !target) throw notFound("Pedido não encontrado");
      store.addMember(roda.id, target.id, target.role === "admin");
      publishRoda(ctx, roda.id);
      resync(ctx, [target.id]);
      return reply.status(204).send();
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    "/api/rodas/:id/requests/:userId",
    { preHandler: requireUser },
    async (req, reply) => {
      const user = currentUser(req);
      rodaFor(req.params.id, user);
      need(user, req.params.id, "convidar", "Seu cargo não pode recusar pedidos");
      if (store.removeRequest(req.params.id, req.params.userId)) publishRoda(ctx, req.params.id);
      return reply.status(204).send();
    },
  );

  // Quem já tem conta abre o convite e entra (ou pede para entrar).
  app.post<{ Params: { code: string } }>(
    "/api/invites/:code/join",
    { preHandler: requireUser, config: rateLimited(ctx, 20, "10 minutes") },
    async (req) => {
      const user = currentUser(req);
      const invite = store.inviteByCode(req.params.code);
      if (!isInviteUsable(invite) || !invite.rodaId) throw notFound("Convite inválido, expirado ou já usado");
      if (store.memberRole(invite.rodaId, user.id)) return { status: "already", rodaId: invite.rodaId };
      if (!store.consumeInvite(invite.code)) throw notFound("Convite inválido, expirado ou já usado");
      return { status: joinViaInvite(ctx, user, invite), rodaId: invite.rodaId };
    },
  );

  // ---------- salas ----------

  app.post<{ Params: { id: string } }>("/api/rodas/:id/channels", { preHandler: requireUser }, async (req, reply) => {
    const user = currentUser(req);
    rodaFor(req.params.id, user);
    need(user, req.params.id, "salas", "Seu cargo não pode criar salas");
    const body = parse(createChannelBody, req.body);
    const channel = store.createChannel(body.name, body.kind, req.params.id);
    hub.publish(store.channelAudience(channel.id), { type: "channel.upsert", channel });
    return reply.status(201).send({ channel });
  });

  /** Reordenar (arrastar na lateral ou setinhas nos ajustes): recebe a lista inteira, de uma vez. */
  app.put<{ Params: { id: string } }>("/api/rodas/:id/channels/order", { preHandler: requireUser }, async (req) => {
    const user = currentUser(req);
    rodaFor(req.params.id, user);
    need(user, req.params.id, "salas", "Seu cargo não pode mexer nas salas");
    const { ids } = parse(reorderChannelsBody, req.body);
    const current = new Set(store.listChannels(req.params.id).map((c) => c.id));
    if (ids.length !== current.size || new Set(ids).size !== ids.length || !ids.every((id) => current.has(id))) {
      throw badRequest("As salas mudaram enquanto você arrumava; tente de novo");
    }
    const channels = store.reorderChannels(ids);
    for (const channel of channels) hub.publish(store.channelAudience(channel.id), { type: "channel.upsert", channel });
    return { channels };
  });
}
