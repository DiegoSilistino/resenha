import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  clientMessage,
  LIMITS,
  WS_CLOSE_UNAUTHORIZED,
  type ClientMessage,
  type PublicUser,
  type ServerEvent,
} from "@resenha/shared";
import type { AppContext } from "../app.ts";
import { isSameOrigin } from "../app.ts";
import { toPublicUser, type UserRecord } from "../store.ts";
import { WatchError } from "../watch/service.ts";
import type { Connection } from "./hub.ts";

/** O cliente avisa a cada 2,5 s; aqui só se descartam repetições coladas (o flood geral é barrado abaixo). */
const TYPING_INTERVAL_MS = 250;
/** Proteção simples contra flood: no máximo N mensagens por janela de 1 s. */
const MAX_MESSAGES_PER_SECOND = 20;
/** Mesa de sons: um som a cada 1,5 s por pessoa (dá para brincar sem virar metralhadora). */
const SOUNDBOARD_INTERVAL_MS = LIMITS.soundboardCooldownMs;

/**
 * Tudo que a pessoa vê, de uma vez: ao conectar e quando o que ela pode ver muda (entrou ou saiu
 * de uma roda, mudou de cargo). Salas, chamadas e vídeos de rodas e conversas alheias ficam de fora.
 */
export function buildHello(ctx: AppContext, user: UserRecord): ServerEvent {
  const { hub, store, voice, watch } = ctx;
  const visible = <T,>(byChannel: Record<string, T>) =>
    Object.fromEntries(Object.entries(byChannel).filter(([channelId]) => store.canAccess(user.id, channelId)));
  // Rede privada (vale para o admin também): só quem a pessoa conhece (amigos, rodas, conversas) e os
  // autores das salas dela. A lista completa de contas fica só no painel do admin (/api/admin/users).
  const related = store.relatedUserIds(user.id);
  const known = new Set([...related, ...store.rodaAuthorIds(user.id)]);
  return {
    type: "hello",
    me: toPublicUser(user),
    users: store
      .listUsers()
      .filter((u) => known.has(u.id))
      .map(toPublicUser),
    channels: store.listChannelsFor(user),
    online: hub.onlineUserIds().filter((id) => related.has(id)),
    voice: visible(voice.snapshot()),
    watch: visible(watch.snapshot()),
    conversations: store.listConversations(user.id),
    conversationUnread: store.conversationUnread(user.id),
    friends: store.listFriends(user.id),
    rodas: store.listRodasFor(user.id),
    openRodas: store.openRodasFor(user.id),
    serverTime: Date.now(),
    features: { gifs: !!ctx.gifs },
    sounds: store.listSounds(),
    ...(user.role === "admin" ? { latestErrorId: store.latestClientErrorId() } : {}),
    ...(user.id === store.siteOwnerId() ? { latestFeedbackId: store.latestClientErrorId(true) } : {}),
  };
}

/** Mudança de perfil: só chega a quem conhece a pessoa. */
export function publishUser(ctx: AppContext, user: PublicUser): void {
  ctx.hub.sendToUsers(ctx.store.relatedUserIds(user.id), { type: "user.upsert", user });
}

/**
 * Pessoas que acabaram de se conhecer (amizade, roda, grupo): quem agora conhece `userId` recebe
 * o perfil e o online dela. Chame para cada lado que precisa ver o outro.
 */
export function introduce(ctx: AppContext, userId: string): void {
  const user = ctx.store.userById(userId);
  if (!user) return;
  const audience = ctx.store.relatedUserIds(userId);
  ctx.hub.sendToUsers(audience, { type: "user.upsert", user: toPublicUser(user) });
  if (ctx.hub.onlineUserIds().includes(userId)) ctx.hub.sendToUsers(audience, { type: "presence", userId, online: true });
}

export function registerSocket(app: FastifyInstance, ctx: AppContext) {
  const { hub, store, voice, watch } = ctx;
  const lastSound = new Map<string, number>();

  app.get("/ws", { websocket: true }, (socket: WebSocket, req) => {
    if (!req.auth) return socket.close(WS_CLOSE_UNAUTHORIZED, "sem sessão");
    // Impede outro site de abrir um WebSocket com o cookie da pessoa (CSWSH).
    if (!isSameOrigin(req)) return socket.close(WS_CLOSE_UNAUTHORIZED, "origem não permitida");

    const conn: Connection = {
      id: randomUUID(),
      userId: req.auth.user.id,
      tokenHash: req.auth.tokenHash,
      socket,
      alive: true,
      lastTypingAt: 0,
    };

    let windowStart = Date.now();
    let windowCount = 0;

    socket.on("pong", () => {
      conn.alive = true;
    });

    socket.on("message", (raw, isBinary) => {
      conn.alive = true;
      const now = Date.now();
      if (now - windowStart >= 1_000) {
        windowStart = now;
        windowCount = 0;
      }
      if (++windowCount > MAX_MESSAGES_PER_SECOND || isBinary) return;

      let data: unknown;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const parsed = clientMessage.safeParse(data);
      if (!parsed.success) return;
      handle(conn, parsed.data).catch((err) => req.log.error(err, "erro ao tratar mensagem do WebSocket"));
    });

    socket.on("close", () => {
      hub.remove(conn.id);
      voice.leave(conn.userId, conn.id);
    });

    hub.add(conn);
    hub.send(conn, buildHello(ctx, req.auth.user));
  });

  async function handle(conn: Connection, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "ping":
        hub.send(conn, { type: "pong", t0: msg.t0, serverTime: Date.now() });
        return;

      case "typing": {
        const now = Date.now();
        if (now - conn.lastTypingAt < TYPING_INTERVAL_MS) return;
        // texto, chat do canal de voz ou conversa de que a pessoa participa
        if (!store.channelById(msg.channelId) || !store.canAccess(conn.userId, msg.channelId)) return;
        conn.lastTypingAt = now;
        hub.publish(store.channelAudience(msg.channelId), { type: "typing", channelId: msg.channelId, userId: conn.userId }, conn.id);
        return;
      }

      case "voice.join":
        if (!store.canCall(conn.userId, msg.channelId)) return;
        voice.join(conn.userId, conn.id, msg.channelId);
        return;

      case "voice.leave":
        voice.leave(conn.userId, conn.id);
        return;

      case "voice.flags":
        voice.setFlags(conn.userId, conn.id, msg);
        return;

      case "soundboard.play": {
        if (!voice.isIn(conn.userId, msg.channelId)) {
          hub.send(conn, { type: "notice", level: "error", text: "Entre no canal de voz para tocar sons." });
          return;
        }
        const now = Date.now();
        if (now - (lastSound.get(conn.userId) ?? 0) < SOUNDBOARD_INTERVAL_MS) return;
        if (!store.soundById(msg.soundId)) return;
        lastSound.set(conn.userId, now);
        const event = { type: "soundboard.played", channelId: msg.channelId, soundId: msg.soundId, userId: conn.userId } as const;
        for (const connId of voice.connectionsIn(msg.channelId)) hub.sendToConnection(connId, event);
        return;
      }

      case "watch": {
        if (!voice.isIn(conn.userId, msg.channelId)) {
          hub.send(conn, { type: "notice", level: "error", text: "Entre no canal de voz para usar o Assistir juntos." });
          return;
        }
        try {
          await watch.handle(conn.userId, msg.channelId, msg.action);
        } catch (err) {
          if (!(err instanceof WatchError)) throw err;
          hub.send(conn, { type: "notice", level: "error", text: err.message });
        }
        return;
      }
    }
  }
}
