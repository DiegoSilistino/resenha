import type { FastifyInstance } from "fastify";
import {
  createMessageBody,
  editMessageBody,
  LIMITS,
  listMessagesQuery,
  reactionEmojiSchema,
  type ServerEvent,
} from "@resenha/shared";
import { rateLimited, requireUser, type AppContext } from "../app.ts";
import { badRequest, currentUser, forbidden, notFound, parse } from "../http.ts";
import { AttachmentLinkError } from "../store.ts";

export function registerMessageRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, hub, uploads } = ctx;

  // Canais de voz também têm chat (para mandar link ou print durante a call). Conversa privada
  // de que a pessoa não participa responde como se não existisse.
  const messageChannel = (id: string, userId: string) => {
    const channel = store.channelById(id);
    if (!channel || !store.canAccess(userId, channel.id)) throw notFound("Canal não encontrado");
    return channel;
  };

  /** Mensagem que a pessoa pode ver (de conversa alheia: 404). */
  const visibleMessage = (raw: string, userId: string) => {
    const message = store.messageById(parseMessageId(raw));
    if (!message || !store.canAccess(userId, message.channelId)) throw notFound("Mensagem não encontrada");
    return message;
  };

  const publish = (channelId: string, event: ServerEvent) => hub.publish(store.channelAudience(channelId), event);

  const parseMessageId = (raw: string) => {
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id <= 0) throw notFound("Mensagem não encontrada");
    return id;
  };

  app.get<{ Params: { id: string } }>(
    "/api/channels/:id/messages",
    { preHandler: requireUser },
    async (req) => {
      const channel = messageChannel(req.params.id, currentUser(req).id);
      const q = parse(listMessagesQuery, req.query);
      if (q.since) return store.listMessagesSince(channel.id, q.before, q.since);
      const messages = store.listMessages(channel.id, q.before, q.limit);
      return { messages, hasMore: messages.length === q.limit };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/channels/:id/messages",
    { preHandler: requireUser, config: rateLimited(ctx, 30, "10 seconds") },
    async (req, reply) => {
      const channel = messageChannel(req.params.id, currentUser(req).id);
      const body = parse(createMessageBody, req.body);
      const perms = store.channelPerms(currentUser(req), channel.id);
      if (!perms.has("enviar")) throw forbidden("Seu cargo não pode mandar mensagens aqui");
      if (body.attachmentIds.length > 0 && !perms.has("anexar")) throw forbidden("Seu cargo não pode mandar arquivos aqui");
      if (body.replyTo !== undefined) {
        const original = store.messageById(body.replyTo);
        if (!original || original.channelId !== channel.id) {
          throw badRequest("A mensagem que você está respondendo não existe mais");
        }
      }
      try {
        const message = store.createMessage({
          channelId: channel.id,
          authorId: currentUser(req).id,
          content: body.content.trim(),
          attachmentIds: body.attachmentIds,
          replyTo: body.replyTo ?? null,
        });
        if (!message) throw new Error("mensagem não criada");
        publish(channel.id, { type: "message.create", message });
        return reply.status(201).send({ message });
      } catch (err) {
        if (err instanceof AttachmentLinkError) throw badRequest("Um dos anexos é inválido ou já foi usado");
        throw err;
      }
    },
  );

  app.patch<{ Params: { id: string } }>("/api/messages/:id", { preHandler: requireUser }, async (req) => {
    const existing = visibleMessage(req.params.id, currentUser(req).id);
    if (existing.authorId !== currentUser(req).id) throw forbidden("Você só pode editar suas mensagens");
    const { content } = parse(editMessageBody, req.body);
    const message = store.editMessage(existing.id, content)!;
    publish(message.channelId, { type: "message.update", message });
    return { message };
  });

  // ---------- reações ----------

  const reactionTarget = (params: { id: string; emoji: string }, userId: string) => {
    const message = visibleMessage(params.id, userId);
    return { message, emoji: parse(reactionEmojiSchema, params.emoji) };
  };

  const broadcastReactions = (channelId: string, messageId: number) =>
    publish(channelId, { type: "message.reactions", channelId, messageId, reactions: store.reactionsFor(messageId) });

  app.put<{ Params: { id: string; emoji: string } }>(
    "/api/messages/:id/reactions/:emoji",
    { preHandler: requireUser, config: rateLimited(ctx, 40, "10 seconds") },
    async (req, reply) => {
      const { message, emoji } = reactionTarget(req.params, currentUser(req).id);
      const result = store.addReaction(message.id, currentUser(req).id, emoji);
      if (result === "limit") throw badRequest(`Esta mensagem já tem ${LIMITS.reactionsPerMessage} emojis diferentes`);
      if (result === "added") broadcastReactions(message.channelId, message.id);
      return reply.status(204).send();
    },
  );

  app.delete<{ Params: { id: string; emoji: string } }>(
    "/api/messages/:id/reactions/:emoji",
    { preHandler: requireUser, config: rateLimited(ctx, 40, "10 seconds") },
    async (req, reply) => {
      const { message, emoji } = reactionTarget(req.params, currentUser(req).id);
      if (store.removeReaction(message.id, currentUser(req).id, emoji)) {
        broadcastReactions(message.channelId, message.id);
      }
      return reply.status(204).send();
    },
  );

  app.delete<{ Params: { id: string } }>("/api/messages/:id", { preHandler: requireUser }, async (req, reply) => {
    const user = currentUser(req);
    const existing = visibleMessage(req.params.id, user.id);
    // quem modera a roda (expulsar) também apaga mensagens dos outros
    if (existing.authorId !== user.id && !store.channelPerms(user, existing.channelId).has("expulsar")) {
      throw forbidden("Você só pode apagar suas mensagens");
    }
    await uploads.remove(store.deleteMessage(existing.id));
    publish(existing.channelId, { type: "message.delete", channelId: existing.channelId, messageId: existing.id });
    return reply.status(204).send();
  });
}
