import type { FastifyInstance } from "fastify";
import {
  addConversationMembersBody,
  createConversationBody,
  friendRequestBody,
  renameConversationBody,
  LIMITS,
  readConversationBody,
  type Conversation,
} from "@resenha/shared";
import { rateLimited, requireUser, type AppContext } from "../app.ts";
import { badRequest, currentUser, notFound, parse } from "../http.ts";
import type { UserRecord } from "../store.ts";

/** Amizades e conversas privadas (a dois e em grupo). */
export function registerSocialRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, hub, voice, watch, gateway, uploads } = ctx;

  // ---------- amigos ----------

  /** Cada uma das duas pessoas recebe a amizade do ponto de vista dela (ou a remoção). */
  const notifyFriendship = (a: string, b: string) => {
    for (const [viewer, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const friend = store.friendEntry(viewer, other);
      hub.sendToUser(viewer, friend ? { type: "friend.upsert", friend } : { type: "friend.remove", userId: other });
    }
  };

  const activeUser = (user: UserRecord | null) => {
    if (!user || user.disabled || user.removed) throw notFound("Ninguém com esse nome por aqui");
    return user;
  };

  const requestFriend = (from: UserRecord, to: UserRecord, quietIfDone = false) => {
    if (from.id === to.id) throw badRequest("Esse é você");
    const result = store.requestFriend(from.id, to.id);
    if (result === "already" && !quietIfDone) {
      throw badRequest(store.areFriends(from.id, to.id) ? "Vocês já são amigos" : "Pedido já enviado");
    }
    if (result !== "already") notifyFriendship(from.id, to.id);
    return { friend: store.friendEntry(from.id, to.id)! };
  };

  app.post("/api/friends", { preHandler: requireUser, config: rateLimited(ctx, 20, "1 minute") }, async (req) => {
    const { who } = parse(friendRequestBody, req.body);
    const found = store.findPeople(who);
    if (found.length > 1) throw badRequest("Tem mais de uma pessoa com esse nick: use nick#tag (o #tag aparece no perfil)");
    return requestFriend(currentUser(req), activeUser(found[0] ?? null));
  });

  app.post<{ Params: { userId: string } }>("/api/friends/:userId/accept", { preHandler: requireUser }, async (req) => {
    const me = currentUser(req);
    if (!store.acceptFriend(me.id, req.params.userId)) throw notFound("Pedido não encontrado");
    notifyFriendship(me.id, req.params.userId);
    return { friend: store.friendEntry(me.id, req.params.userId)! };
  });

  // Recusar, cancelar o pedido ou desfazer a amizade.
  app.delete<{ Params: { userId: string } }>("/api/friends/:userId", { preHandler: requireUser }, async (req, reply) => {
    const me = currentUser(req);
    if (store.removeFriendship(me.id, req.params.userId)) notifyFriendship(me.id, req.params.userId);
    return reply.status(204).send();
  });

  app.get("/api/friends/link", { preHandler: requireUser }, async (req) => ({ code: store.friendCode(currentUser(req).id) }));

  // Quem abre o link de alguém já manda o pedido (ou vira amigo, se a pessoa já tinha pedido).
  app.post<{ Params: { code: string } }>(
    "/api/friends/link/:code",
    { preHandler: requireUser, config: rateLimited(ctx, 20, "1 minute") },
    async (req) => {
      if (!/^[\w-]{6,32}$/.test(req.params.code)) throw notFound("Link de amizade inválido");
      const owner = store.userByFriendCode(req.params.code);
      if (!owner || owner.disabled || owner.removed) throw notFound("Link de amizade inválido");
      return requestFriend(currentUser(req), owner, true);
    },
  );

  // ---------- conversas ----------

  const conversationFor = (id: string, userId: string): Conversation => {
    const c = store.conversationById(id);
    if (!c || !c.memberIds.includes(userId)) throw notFound("Conversa não encontrada");
    return c;
  };

  const publishConversation = (c: Conversation) =>
    hub.sendToUsers(c.memberIds, { type: "conversation.upsert", conversation: c });

  // 1 pessoa sem nome = conversa a dois (abre a que já existe); com nome ou mais gente = grupo.
  app.post(
    "/api/conversations",
    { preHandler: requireUser, config: rateLimited(ctx, 20, "1 minute") },
    async (req, reply) => {
      const me = currentUser(req);
      const body = parse(createConversationBody, req.body);
      const ids = [...new Set(body.userIds)].filter((id) => id !== me.id);
      if (ids.length === 0) throw badRequest("Escolha alguém");
      for (const id of ids) {
        activeUser(store.userById(id));
        if (!store.areFriends(me.id, id)) throw badRequest("Só dá para chamar amigos para uma conversa privada");
      }

      if (ids.length === 1 && !body.name) {
        const existing = store.findDm(me.id, ids[0]!);
        if (existing) return { conversation: store.conversationById(existing)! };
        const conversation = store.createConversation("dm", "", [me.id, ids[0]!]);
        publishConversation(conversation);
        return reply.status(201).send({ conversation });
      }

      if (ids.length + 1 > LIMITS.groupMax) {
        throw badRequest(`Um grupo tem no máximo ${LIMITS.groupMax} pessoas, contando você`);
      }
      const conversation = store.createConversation("group", body.name || "Grupo", [me.id, ...ids]);
      publishConversation(conversation);
      return reply.status(201).send({ conversation });
    },
  );

  const groupFor = (id: string, userId: string) => {
    const c = conversationFor(id, userId);
    if (c.type !== "group") throw badRequest("Só grupos têm nome e mais gente");
    return c;
  };

  app.patch<{ Params: { id: string } }>("/api/conversations/:id", { preHandler: requireUser }, async (req) => {
    const c = groupFor(req.params.id, currentUser(req).id);
    store.renameConversation(c.id, parse(renameConversationBody, req.body).name);
    const conversation = store.conversationById(c.id)!;
    publishConversation(conversation);
    return { conversation };
  });

  // Chamar mais gente para o grupo: só amigos de quem chama, até 10 pessoas.
  app.post<{ Params: { id: string } }>(
    "/api/conversations/:id/members",
    { preHandler: requireUser, config: rateLimited(ctx, 20, "1 minute") },
    async (req) => {
      const me = currentUser(req);
      const c = groupFor(req.params.id, me.id);
      const ids = [...new Set(parse(addConversationMembersBody, req.body).userIds)].filter((id) => !c.memberIds.includes(id));
      for (const id of ids) {
        activeUser(store.userById(id));
        if (!store.areFriends(me.id, id)) throw badRequest("Só dá para chamar amigos para o grupo");
      }
      if (c.memberIds.length + ids.length > LIMITS.groupMax) {
        throw badRequest(`Um grupo tem no máximo ${LIMITS.groupMax} pessoas, contando você`);
      }
      store.addConversationMembers(c.id, ids);
      const conversation = store.conversationById(c.id)!;
      publishConversation(conversation);
      return { conversation };
    },
  );

  // "Visto": até onde a pessoa leu; os outros membros ficam sabendo.
  app.post<{ Params: { id: string } }>("/api/conversations/:id/read", { preHandler: requireUser }, async (req, reply) => {
    const me = currentUser(req);
    const c = conversationFor(req.params.id, me.id);
    const { messageId } = parse(readConversationBody, req.body);
    if (store.markRead(c.id, me.id, messageId)) {
      hub.sendToUsers(c.memberIds, { type: "conversation.read", conversationId: c.id, userId: me.id, messageId });
    }
    return reply.status(204).send();
  });

  // Sair do grupo. O último a sair apaga o grupo.
  app.delete<{ Params: { id: string } }>(
    "/api/conversations/:id/members/me",
    { preHandler: requireUser },
    async (req, reply) => {
      const me = currentUser(req);
      const c = conversationFor(req.params.id, me.id);
      if (c.type !== "group") throw badRequest("Não dá para sair de uma conversa a dois");
      const inCall = voice.isIn(me.id, c.id);
      const { remaining, attachmentIds } = store.leaveConversation(c.id, me.id);
      hub.sendToUser(me.id, { type: "conversation.remove", conversationId: c.id });
      if (inCall) await gateway.kick(me.id, c.id);
      if (remaining.length) {
        publishConversation(store.conversationById(c.id)!);
      } else {
        voice.clearChannel(c.id);
        watch.removeChannel(c.id);
        await uploads.remove(attachmentIds);
      }
      return reply.status(204).send();
    },
  );
}
