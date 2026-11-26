import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import type { Role, ServerEvent } from "@resenha/shared";
import { buildApp, type AppContext } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db.ts";
import { bootstrap } from "../src/bootstrap.ts";
import type { VoiceGateway, VoiceHealth } from "../src/voice/livekit.ts";
import type { TitleFetcher, TitleLookup } from "../src/watch/oembed.ts";
import { newInviteCode } from "../src/routes/admin.ts";
import type { Mailer } from "../src/mail.ts";

export class FakeGateway implements VoiceGateway {
  kicked: { userId: string; channelId: string }[] = [];
  health: VoiceHealth = { ok: true };
  async check() {
    return this.health;
  }
  async createToken(user: { id: string }, channelId: string) {
    return `token:${user.id}:${channelId}`;
  }
  publicUrl(protocol: string, host: string) {
    return `${protocol === "https" ? "wss" : "ws"}://${host}`;
  }
  async kick(userId: string, channelId: string) {
    this.kicked.push({ userId, channelId });
  }
}

export interface TestApp {
  app: FastifyInstance;
  ctx: AppContext;
  gateway: FakeGateway;
  titles: Map<string, TitleLookup>;
  adminInviteUrl: string | null;
  close(): Promise<void>;
}

export async function createTestApp(opts: { gifFetch?: typeof fetch; webDist?: string; mailer?: Mailer } = {}): Promise<TestApp> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "resenha-test-"));
  const config = loadConfig({
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    PUBLIC_URL: "http://localhost:5173",
    ...(opts.gifFetch ? { GIPHY_API_KEY: "chave-de-teste" } : {}),
    ...(opts.webDist ? { WEB_DIST: opts.webDist } : {}),
  });
  const db = openDatabase(":memory:");
  const gateway = new FakeGateway();
  const titles = new Map<string, TitleLookup>();
  const fetchTitle: TitleFetcher = async (id) => titles.get(id) ?? { ok: true, title: `Título ${id}` };
  const { app, ctx } = await buildApp({
    config,
    db,
    voiceGateway: gateway,
    fetchTitle,
    ...(opts.gifFetch ? { gifFetch: opts.gifFetch } : {}),
    ...(opts.mailer ? { mailer: opts.mailer } : {}),
  });
  const { adminInviteUrl } = bootstrap(ctx);
  return {
    app,
    ctx,
    gateway,
    titles,
    adminInviteUrl,
    async close() {
      ctx.hub.closeAll(1001, "fim do teste");
      await app.close();
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export interface TestUser {
  id: string;
  username: string;
  cookie: string;
}

let counter = 0;

/** Cria uma conta pelo fluxo real de convite e devolve o cookie de sessão. */
export async function registerUser(t: TestApp, role: Role = "member", username?: string): Promise<TestUser> {
  const code = newInviteCode();
  t.ctx.store.createInvite({ code, role, maxUses: 1, expiresAt: null, createdBy: null });
  const name = username ?? `user${++counter}`;
  const res = await t.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { code, username: name, displayName: name.toUpperCase(), password: "senha-forte-123" },
  });
  if (res.statusCode !== 201) throw new Error(`registro falhou: ${res.statusCode} ${res.body}`);
  return { id: res.json().me.id, username: name, cookie: cookieHeader(res) };
}

export function cookieHeader(res: { cookies: { name: string; value: string }[] }): string {
  return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

export function textChannelId(t: TestApp): string {
  return t.ctx.store.listChannels().find((c) => c.kind === "text")!.id;
}

export function voiceChannelId(t: TestApp, index = 0): string {
  return t.ctx.store.listChannels().filter((c) => c.kind === "voice")[index]!.id;
}

/** Cliente WebSocket de teste que guarda os eventos e permite esperar por um específico. */
export class TestSocket {
  readonly events: ServerEvent[] = [];
  private waiters: { match: (e: ServerEvent) => boolean; resolve: (e: ServerEvent) => void }[] = [];
  closeCode: number | null = null;
  private constructor(readonly ws: WebSocket) {
    ws.on("message", (data) => {
      const event = JSON.parse(data.toString()) as ServerEvent;
      this.events.push(event);
      this.waiters = this.waiters.filter((w) => {
        if (!w.match(event)) return true;
        w.resolve(event);
        return false;
      });
    });
    ws.on("close", (code) => {
      this.closeCode = code;
    });
  }

  static async connect(port: number, cookie?: string, origin = `http://127.0.0.1:${port}`): Promise<TestSocket> {
    const headers: Record<string, string> = { origin };
    if (cookie) headers.cookie = cookie;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    const socket = new TestSocket(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    return socket;
  }

  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
  }

  waitFor<T extends ServerEvent["type"]>(
    type: T,
    predicate: (e: Extract<ServerEvent, { type: T }>) => boolean = () => true,
    timeoutMs = 2_000,
  ): Promise<Extract<ServerEvent, { type: T }>> {
    const match = (e: ServerEvent) => e.type === type && predicate(e as Extract<ServerEvent, { type: T }>);
    const existing = this.events.find(match);
    if (existing) return Promise.resolve(existing as Extract<ServerEvent, { type: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout esperando ${type}`)), timeoutMs);
      this.waiters.push({
        match,
        resolve: (e) => {
          clearTimeout(timer);
          resolve(e as Extract<ServerEvent, { type: T }>);
        },
      });
    });
  }

  /** Descarta eventos já recebidos (para esperar só pelos próximos). */
  clear() {
    this.events.length = 0;
  }

  waitClose(timeoutMs = 2_000): Promise<number> {
    if (this.closeCode !== null) return Promise.resolve(this.closeCode);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout esperando fechamento")), timeoutMs);
      this.ws.once("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  close() {
    this.ws.close();
  }
}

export async function listen(t: TestApp): Promise<number> {
  await t.app.listen({ host: "127.0.0.1", port: 0 });
  const address = t.app.server.address();
  if (!address || typeof address === "string") throw new Error("sem porta");
  return address.port;
}
