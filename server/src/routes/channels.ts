import type { FastifyInstance } from "fastify";
import { createChannelBody, updateChannelBody } from "@resenha/shared";
import { requireAdmin, type AppContext } from "../app.ts";
import { badRequest, notFound, parse } from "../http.ts";

export function registerChannelRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, hub, voice, watch, gateway, uploads } = ctx;

  app.post("/api/channels", { preHandler: requireAdmin }, async (req, reply) => {
    const body = parse(createChannelBody, req.body);
    const channel = store.createChannel(body.name, body.kind);
    hub.broadcast({ type: "channel.upsert", channel });
    return reply.status(201).send({ channel });
  });

  app.patch<{ Params: { id: string } }>("/api/channels/:id", { preHandler: requireAdmin }, async (req) => {
    const body = parse(updateChannelBody, req.body);
    const channel = store.updateChannel(req.params.id, body);
    if (!channel) throw notFound("Canal não encontrado");
    hub.broadcast({ type: "channel.upsert", channel });
    return { channel };
  });

  app.delete<{ Params: { id: string } }>("/api/channels/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const channel = store.channelById(req.params.id);
    if (!channel) throw notFound("Canal não encontrado");
    if (channel.kind === "text" && store.listChannels().filter((c) => c.kind === "text").length === 1) {
      throw badRequest("Mantenha pelo menos um canal de texto");
    }
    const attachmentIds = store.deleteChannel(channel.id);
    await uploads.remove(attachmentIds);

    const kicked = voice.clearChannel(channel.id);
    watch.removeChannel(channel.id);
    hub.broadcast({ type: "channel.remove", channelId: channel.id });
    await Promise.all(kicked.map((userId) => gateway.kick(userId, channel.id)));
    return reply.status(204).send();
  });
}
