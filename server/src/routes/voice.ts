import type { FastifyInstance, FastifyRequest } from "fastify";
import { voiceTokenBody, type VoiceTokenResponse } from "@resenha/shared";
import { rateLimited, requireUser, type AppContext } from "../app.ts";
import { badRequest, currentUser, HttpError, notFound, parse } from "../http.ts";
import type { VoiceHealth } from "../voice/livekit.ts";

/** Mensagem para quem tentou entrar na voz: o que aconteceu e o que fazer. */
export function voiceProblemMessage(health: VoiceHealth & { ok: false }, development: boolean): string {
  switch (health.problem) {
    case "unreachable":
      return development
        ? "O servidor de voz (LiveKit) não está rodando. Use `npm run dev`, que inicia ele junto, e veja as linhas [voz] no terminal."
        : "O servidor de voz está fora do ar. Quem administra: confira se o serviço livekit está rodando (docker compose ps).";
    case "unauthorized":
      return "O servidor de voz recusou as credenciais: LIVEKIT_API_KEY e LIVEKIT_API_SECRET do app não batem com as do LiveKit.";
    case "error":
      return "O servidor de voz respondeu com erro. Tente de novo em instantes.";
  }
}

export function registerVoiceRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, gateway, config } = ctx;
  const development = config.env === "development";
  let lastWarnAt = 0;

  async function ensureVoiceServer(req: FastifyRequest): Promise<void> {
    const health = await gateway.check();
    if (health.ok) return;
    // Registra no log do servidor (no máximo 1 vez por minuto, para não poluir).
    if (Date.now() - lastWarnAt > 60_000) {
      lastWarnAt = Date.now();
      req.log.warn({ problem: health.problem, detail: health.detail }, "servidor de voz indisponível");
    }
    throw new HttpError(503, voiceProblemMessage(health, development));
  }

  app.post(
    "/api/voice/token",
    { preHandler: requireUser, config: rateLimited(ctx, 30, "1 minute") },
    async (req): Promise<VoiceTokenResponse> => {
      const { channelId } = parse(voiceTokenBody, req.body);
      const channel = store.channelById(channelId);
      if (!channel) throw notFound("Canal não encontrado");
      if (channel.kind !== "voice") throw badRequest("Esse canal não é de voz");
      await ensureVoiceServer(req);
      return {
        url: gateway.publicUrl(req.protocol, req.host),
        token: await gateway.createToken(currentUser(req), channel.id),
      };
    },
  );

  /** Diagnóstico rápido: abra /api/voice/health logado para ver se o app alcança o LiveKit. */
  app.get("/api/voice/health", { preHandler: requireUser }, async (req) => {
    const health = await gateway.check();
    return health.ok
      ? { ok: true, browserUrl: gateway.publicUrl(req.protocol, req.host) }
      : { ok: false, problem: health.problem, message: voiceProblemMessage(health, development) };
  });
}
