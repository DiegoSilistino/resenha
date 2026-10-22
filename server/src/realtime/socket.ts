import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { clientMessage, WS_CLOSE_UNAUTHORIZED, type ClientMessage } from "@resenha/shared";
import type { AppContext } from "../app.ts";
import { isSameOrigin } from "../app.ts";
import { toPublicUser } from "../store.ts";
import { WatchError } from "../watch/service.ts";
import type { Connection } from "./hub.ts";

const TYPING_INTERVAL_MS = 2_500;
/** Proteção simples contra flood: no máximo N mensagens por janela de 1 s. */
const MAX_MESSAGES_PER_SECOND = 20;

export function registerSocket(app: FastifyInstance, ctx: AppContext) {
  const { hub, store, voice, watch } = ctx;

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
    hub.send(conn, {
      type: "hello",
      me: toPublicUser(req.auth.user),
      users: store.listUsers().map(toPublicUser),
      channels: store.listChannels(),
      online: hub.onlineUserIds(),
      voice: voice.snapshot(),
      watch: watch.snapshot(),
      serverTime: Date.now(),
    });
  });

  async function handle(conn: Connection, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "ping":
        hub.send(conn, { type: "pong", t0: msg.t0, serverTime: Date.now() });
        return;

      case "typing": {
        const now = Date.now();
        if (now - conn.lastTypingAt < TYPING_INTERVAL_MS) return;
        if (store.channelById(msg.channelId)?.kind !== "text") return;
        conn.lastTypingAt = now;
        hub.broadcast({ type: "typing", channelId: msg.channelId, userId: conn.userId }, conn.id);
        return;
      }

      case "voice.join":
        if (store.channelById(msg.channelId)?.kind !== "voice") return;
        voice.join(conn.userId, conn.id, msg.channelId);
        return;

      case "voice.leave":
        voice.leave(conn.userId, conn.id);
        return;

      case "voice.flags":
        voice.setFlags(conn.userId, conn.id, msg);
        return;

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
