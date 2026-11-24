import type { FastifyInstance } from "fastify";
import { createChannelBody, updateChannelBody } from "@resenha/shared";
import { requireAdmin, requireUser, type AppContext } from "../app.ts";
import { badRequest, currentUser, forbidden, notFound, parse } from "../http.ts";

export function registerChannelRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, hub, voice, watch, gateway, uploads } = ctx;

  app.post("/api/channels", { preHandler: requireAdmin }, async (req, reply) => {
    const body = parse(createChannelBody, req.body);
    const channel = store.createChannel(body.name, body.kind);
    hub.publish(store.channelAudience(channel.id), { type: "channel.upsert", channel });
    return reply.status(201).send({ channel });
  });

  /** Sala de roda que a pessoa pode editar (permissão "salas"); conversa privada não passa por aqui. */
  const editableRoom = (id: string, user: Parameters<typeof store.permsOf>[0]) => {
    const channel = store.channelById(id);
    if (!channel || channel.conversation || !channel.rodaId || !store.canAccess(user.id, channel.id)) {
      throw notFound("Canal não encontrado");
    }
    if (!store.permsOf(user, channel.rodaId).has("salas")) throw forbidden("Seu cargo não pode mexer nas salas");
    return channel;
  };

  app.patch<{ Params: { id: string } }>("/api/channels/:id", { preHandler: requireUser }, async (req) => {
    const body = parse(updateChannelBody, req.body);
    editableRoom(req.params.id, currentUser(req));
    const channel = store.updateChannel(req.params.id, body);
    if (!channel) throw notFound("Canal não encontrado");
    hub.publish(store.channelAudience(channel.id), { type: "channel.upsert", channel });
    return { channel };
  });

  app.delete<{ Params: { id: string } }>("/api/channels/:id", { preHandler: requireUser }, async (req, reply) => {
    const channel = editableRoom(req.params.id, currentUser(req));
    if (channel.kind === "text" && store.listChannels(channel.rodaId).filter((c) => c.kind === "text").length === 1) {
      throw badRequest("Mantenha pelo menos uma sala de texto na roda");
    }
    // quem via a sala fica sabendo que ela sumiu (depois de apagada não dá mais para saber quem era)
    const audience = store.channelAudience(channel.id);
    const attachmentIds = store.deleteChannel(channel.id);
    await uploads.remove(attachmentIds);

    const kicked = voice.clearChannel(channel.id);
    watch.removeChannel(channel.id);
    hub.publish(audience, { type: "channel.remove", channelId: channel.id });
    await Promise.all(kicked.map((userId) => gateway.kick(userId, channel.id)));
    return reply.status(204).send();
  });
}
