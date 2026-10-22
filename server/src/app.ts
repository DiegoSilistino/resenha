import { existsSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { LIMITS } from "@resenha/shared";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { forbidden, HttpError, sendError, unauthorized } from "./http.ts";
import { Hub } from "./realtime/hub.ts";
import { registerSocket } from "./realtime/socket.ts";
import { resolveSession, SESSION_COOKIE } from "./auth/sessions.ts";
import { registerAdminRoutes } from "./routes/admin.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerChannelRoutes } from "./routes/channels.ts";
import { registerMeRoutes } from "./routes/me.ts";
import { registerMessageRoutes } from "./routes/messages.ts";
import { registerUploadRoutes } from "./routes/uploads.ts";
import { registerVoiceRoutes } from "./routes/voice.ts";
import { Store } from "./store.ts";
import { UploadStorage } from "./uploads/storage.ts";
import { LiveKitGateway, type VoiceGateway } from "./voice/livekit.ts";
import { VoicePresence } from "./voice/presence.ts";
import { createOEmbedFetcher, type TitleFetcher } from "./watch/oembed.ts";
import { WatchService } from "./watch/service.ts";

export interface AppDeps {
  config: Config;
  db: Db;
  /** Substituíveis em testes. */
  voiceGateway?: VoiceGateway;
  fetchTitle?: TitleFetcher;
}

export interface AppContext {
  config: Config;
  store: Store;
  hub: Hub;
  voice: VoicePresence;
  watch: WatchService;
  gateway: VoiceGateway;
  uploads: UploadStorage;
}

export const requireUser = async (req: FastifyRequest) => {
  if (!req.auth) throw unauthorized();
};

export const requireAdmin = async (req: FastifyRequest) => {
  if (!req.auth) throw unauthorized();
  if (req.auth.user.role !== "admin") throw forbidden("Só administradores podem fazer isso");
};

/** Limite de requisições por rota (por usuário logado, senão por IP). Relaxado nos testes. */
export const rateLimited = (ctx: AppContext, max: number, timeWindow: string) => ({
  rateLimit: { max: ctx.config.env === "test" ? 10_000 : max, timeWindow },
});

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function buildApp(deps: AppDeps): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const { config } = deps;
  const hub = new Hub();
  const voice = new VoicePresence(hub);
  const ctx: AppContext = {
    config,
    store: new Store(deps.db),
    hub,
    voice,
    watch: new WatchService(hub, deps.fetchTitle ?? createOEmbedFetcher()),
    gateway: deps.voiceGateway ?? new LiveKitGateway(config.livekit),
    uploads: new UploadStorage(config.uploadsDir),
  };
  await ctx.uploads.init();
  voice.onChannelEmpty((channelId) => ctx.watch.pauseIfPlaying(channelId));

  const app = Fastify({
    trustProxy: config.trustProxy,
    logger:
      config.env === "test"
        ? false
        : { level: config.logLevel, redact: ["req.headers.cookie", 'res.headers["set-cookie"]'] },
  });

  app.decorateRequest("auth", null);

  await app.register(cookie);
  await app.register(helmet, {
    // CSP só faz sentido quando este servidor entrega o frontend (produção).
    contentSecurityPolicy: config.webDist ? { useDefaults: false, directives: cspDirectives(config) } : false,
    crossOriginEmbedderPolicy: false,
    // O player do YouTube exige o cabeçalho Referer; "no-referrer" quebra o embed (erro 153).
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (req) => req.auth?.user.id ?? req.ip,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: "Muitas tentativas seguidas. Espere um pouco e tente de novo.",
    }),
  });
  await app.register(multipart, {
    limits: { fileSize: LIMITS.uploadMaxBytes, files: 1, fields: 5, parts: 6 },
  });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });
  // Registro sem rotas: só habilita reply.sendFile para os anexos.
  await app.register(fastifyStatic, { root: config.uploadsDir, serve: false });

  // Sessão pelo cookie, em toda requisição da API e do WebSocket.
  app.addHook("onRequest", async (req) => {
    if (!req.url.startsWith("/api/") && !req.url.startsWith("/ws")) return;
    const session = resolveSession(ctx.store, req.cookies[SESSION_COOKIE]);
    req.auth = session ? { user: session.user, tokenHash: session.tokenHash } : null;

    // Defesa contra CSRF além do SameSite=Lax: mutações vindas de outro site são recusadas.
    if (!SAFE_METHODS.has(req.method) && !isSameOrigin(req)) throw forbidden("Origem não permitida");
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof HttpError) return sendError(reply, err);
    const status = err.statusCode ?? 500;
    if (status === 429) return sendError(reply, new HttpError(429, "Muitas tentativas seguidas. Espere um pouco e tente de novo."));
    if (status === 413 || err.code === "FST_REQ_FILE_TOO_LARGE") {
      return sendError(reply, new HttpError(413, `Arquivo maior que ${LIMITS.uploadMaxBytes / 1024 / 1024} MB`));
    }
    if (status < 500) return sendError(reply, new HttpError(status, err.message));
    req.log.error(err);
    return sendError(reply, new HttpError(500, "Erro interno. Tente de novo em instantes."));
  });

  app.get("/api/health", async () => ({ ok: true }));

  registerAuthRoutes(app, ctx);
  registerMeRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  registerChannelRoutes(app, ctx);
  registerMessageRoutes(app, ctx);
  registerUploadRoutes(app, ctx);
  registerVoiceRoutes(app, ctx);
  registerSocket(app, ctx);

  await registerFrontend(app, config);

  return { app, ctx };
}

export function isSameOrigin(req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // navegadores sempre mandam Origin em POST cross-site; clientes não-navegador não usam cookie de terceiros
  try {
    return new URL(origin).host === req.host;
  } catch {
    return false;
  }
}

async function registerFrontend(app: FastifyInstance, config: Config) {
  const dist = config.webDist;
  if (!dist || !existsSync(path.join(dist, "index.html"))) {
    app.setNotFoundHandler((_req, reply) => sendError(reply, new HttpError(404, "Não encontrado")));
    return;
  }
  await app.register(fastifyStatic, {
    root: dist,
    decorateReply: false,
    wildcard: false,
    index: false,
    setHeaders(res, filePath) {
      // Arquivos com hash no nome podem ficar em cache para sempre; o index.html nunca.
      res.setHeader(
        "Cache-Control",
        filePath.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
      );
    },
  });
  // SPA: qualquer rota GET que não seja API/arquivo cai no index.html.
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== "GET" || req.url.startsWith("/api/") || req.url.startsWith("/ws")) {
      return sendError(reply, new HttpError(404, "Não encontrado"));
    }
    reply.header("Cache-Control", "no-cache");
    return reply.sendFile("index.html", dist);
  });
}

function cspDirectives(config: Config): Record<string, string[]> {
  const connect = ["'self'"];
  if (config.livekit.publicUrl) connect.push(new URL(config.livekit.publicUrl).origin);
  return {
    "default-src": ["'self'"],
    "script-src": ["'self'", "https://www.youtube.com", "https://s.ytimg.com"],
    "frame-src": ["https://www.youtube.com", "https://www.youtube-nocookie.com"],
    "img-src": ["'self'", "data:", "blob:", "https://i.ytimg.com"],
    "media-src": ["'self'", "blob:"],
    "connect-src": connect,
    "style-src": ["'self'", "'unsafe-inline'"],
    "font-src": ["'self'", "data:"],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
}
