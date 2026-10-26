import type { FastifyInstance } from "fastify";
import { createMessageBody, editMessageBody, LIMITS, listMessagesQuery, reactionEmojiSchema } from "@resenha/shared";
import { rateLimited, requireUser, type AppContext } from "../app.ts";
import { badRequest, currentUser, forbidden, notFound, parse } from "../http.ts";
import { AttachmentLinkError } from "../store.ts";

export function registerMessageRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, hub, uploads } = ctx;

  // Canais de voz também têm chat (para mandar link ou print durante a call).
  const messageChannel = (id: string) => {
    const channel = store.channelById(id);
    if (!channel) throw notFound("Canal não encontrado");
    return channel;
  };

  const parseMessageId = (raw: string) => {
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id <= 0) throw notFound("Mensagem não encontrada");
    return id;
  };

  app.get<{ Params: { id: string } }>(
    "/api/channels/:id/messages",
    { preHandler: requireUser },
    async (req) => {
      const channel = messageChannel(req.params.id);
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
      const channel = messageChannel(req.params.id);
      const body = parse(createMessageBody, req.body);
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
        hub.broadcast({ type: "message.create", message });
        return reply.status(201).send({ message });
      } catch (err) {
        if (err instanceof AttachmentLinkError) throw badRequest("Um dos anexos é inválido ou já foi usado");
        throw err;
      }
    },
  );

  app.patch<{ Params: { id: string } }>("/api/messages/:id", { preHandler: requireUser }, async (req) => {
    const existing = store.messageById(parseMessageId(req.params.id));
    if (!existing) throw notFound("Mensagem não encontrada");
    if (existing.authorId !== currentUser(req).id) throw forbidden("Você só pode editar suas mensagens");
    const { content } = parse(editMessageBody, req.body);
    const message = store.editMessage(existing.id, content)!;
    hub.broadcast({ type: "message.update", message });
    return { message };
  });

  // ---------- reações ----------

  const reactionTarget = (params: { id: string; emoji: string }) => {
    const message = store.messageById(parseMessageId(params.id));
    if (!message) throw notFound("Mensagem não encontrada");
    return { message, emoji: parse(reactionEmojiSchema, params.emoji) };
  };

  const broadcastReactions = (channelId: string, messageId: number) =>
    hub.broadcast({ type: "message.reactions", channelId, messageId, reactions: store.reactionsFor(messageId) });

  app.put<{ Params: { id: string; emoji: string } }>(
    "/api/messages/:id/reactions/:emoji",
    { preHandler: requireUser, config: rateLimited(ctx, 40, "10 seconds") },
    async (req, reply) => {
      const { message, emoji } = reactionTarget(req.params);
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
      const { message, emoji } = reactionTarget(req.params);
      if (store.removeReaction(message.id, currentUser(req).id, emoji)) {
        broadcastReactions(message.channelId, message.id);
      }
      return reply.status(204).send();
    },
  );

  app.delete<{ Params: { id: string } }>("/api/messages/:id", { preHandler: requireUser }, async (req, reply) => {
    const existing = store.messageById(parseMessageId(req.params.id));
    if (!existing) throw notFound("Mensagem não encontrada");
    const user = currentUser(req);
    if (existing.authorId !== user.id && user.role !== "admin") {
      throw forbidden("Você só pode apagar suas mensagens");
    }
    await uploads.remove(store.deleteMessage(existing.id));
    hub.broadcast({ type: "message.delete", channelId: existing.channelId, messageId: existing.id });
    return reply.status(204).send();
  });
}
