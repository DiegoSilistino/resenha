import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { voiceProblemMessage } from "../src/routes/voice.ts";
import { LiveKitGateway } from "../src/voice/livekit.ts";
import { createTestApp, registerUser, voiceChannelId, type TestApp } from "./helpers.ts";

describe("rota de voz com o LiveKit indisponível", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.close();
  });

  const askToken = async (cookie: string) =>
    t.app.inject({
      method: "POST",
      url: "/api/voice/token",
      headers: { cookie },
      payload: { channelId: voiceChannelId(t) },
    });

  it("fora do ar: 503 com mensagem que diz o que fazer, sem emitir token", async () => {
    const u = await registerUser(t);
    t.gateway.health = { ok: false, problem: "unreachable", detail: "ECONNREFUSED" };
    const res = await askToken(u.cookie);
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/fora do ar/);
    expect(res.json().token).toBeUndefined();
  });

  it("chaves erradas: 503 explicando as variáveis", async () => {
    const u = await registerUser(t);
    t.gateway.health = { ok: false, problem: "unauthorized", detail: "401" };
    const res = await askToken(u.cookie);
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/LIVEKIT_API_KEY/);
  });

  it("/api/voice/health mostra o diagnóstico e a URL do navegador", async () => {
    const u = await registerUser(t);
    const ok = await t.app.inject({ method: "GET", url: "/api/voice/health", headers: { cookie: u.cookie, host: "x.com" } });
    expect(ok.json()).toEqual({ ok: true, browserUrl: "ws://x.com" });

    t.gateway.health = { ok: false, problem: "unreachable", detail: "ECONNREFUSED" };
    const down = await t.app.inject({ method: "GET", url: "/api/voice/health", headers: { cookie: u.cookie } });
    expect(down.json()).toMatchObject({ ok: false, problem: "unreachable" });
  });

  it("/api/voice/health exige login", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/voice/health" });
    expect(res.statusCode).toBe(401);
  });

  it("em desenvolvimento a mensagem aponta para o npm run dev", () => {
    const msg = voiceProblemMessage({ ok: false, problem: "unreachable", detail: "" }, true);
    expect(msg).toMatch(/npm run dev/);
  });
});

describe("LiveKitGateway.check contra uma API falsa do LiveKit", () => {
  let server: Server;
  let port: number;
  let calls: IncomingMessage[] = [];
  let reply: { status: number; body: unknown } = { status: 200, body: { rooms: [] } };

  beforeEach(async () => {
    calls = [];
    reply = { status: 200, body: { rooms: [] } };
    server = createServer((req, res) => {
      calls.push(req);
      req.resume();
      req.on("end", () => {
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const gateway = (p = port) =>
    new LiveKitGateway({
      apiUrl: `http://127.0.0.1:${p}`,
      publicUrl: null,
      apiKey: "devkey",
      apiSecret: "secret",
    });

  it("no ar e com as chaves certas: ok, autenticando com JWT", async () => {
    expect(await gateway().check()).toEqual({ ok: true });
    expect(calls[0]!.url).toBe("/twirp/livekit.RoomService/ListRooms");
    expect(calls[0]!.headers.authorization).toMatch(/^Bearer ey/);
  });

  it("guarda o resultado bom por alguns segundos (não consulta a cada entrada)", async () => {
    const g = gateway();
    await g.check();
    await g.check();
    await g.check();
    expect(calls).toHaveLength(1);
  });

  it("chave errada (401): unauthorized", async () => {
    reply = { status: 401, body: { code: "unauthenticated", msg: "invalid token" } };
    expect(await gateway().check()).toMatchObject({ ok: false, problem: "unauthorized" });
  });

  it("erro interno (500): error", async () => {
    reply = { status: 500, body: { code: "internal", msg: "boom" } };
    expect(await gateway().check()).toMatchObject({ ok: false, problem: "error" });
  });

  it("porta fechada: unreachable, rápido", async () => {
    const closed = await new Promise<number>((resolve) => {
      const s = createServer();
      s.listen(0, "127.0.0.1", () => {
        const p = (s.address() as AddressInfo).port;
        s.close(() => resolve(p));
      });
    });
    const started = Date.now();
    const result = await gateway(closed).check();
    expect(result).toMatchObject({ ok: false, problem: "unreachable" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
