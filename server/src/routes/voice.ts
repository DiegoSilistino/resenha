import type { FastifyInstance } from "fastify";
import { voiceTokenBody, type VoiceTokenResponse } from "@resenha/shared";
import { rateLimited, requireUser, type AppContext } from "../app.ts";
import { badRequest, currentUser, notFound, parse } from "../http.ts";

export function registerVoiceRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, gateway } = ctx;

  app.post(
    "/api/voice/token",
    { preHandler: requireUser, config: rateLimited(ctx, 30, "1 minute") },
    async (req): Promise<VoiceTokenResponse> => {
      const { channelId } = parse(voiceTokenBody, req.body);
      const channel = store.channelById(channelId);
      if (!channel) throw notFound("Canal não encontrado");
      if (channel.kind !== "voice") throw badRequest("Esse canal não é de voz");
      return {
        url: gateway.publicUrl(req.protocol, req.host),
        token: await gateway.createToken(currentUser(req), channel.id),
      };
    },
  );
}
