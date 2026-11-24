import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WS_CLOSE_SESSION_REVOKED, WS_CLOSE_UNAUTHORIZED } from "@resenha/shared";
import {
  cookieHeader,
  createTestApp,
  listen,
  registerUser,
  TestSocket,
  textChannelId,
  voiceChannelId,
  type TestApp,
  type TestUser,
} from "./helpers.ts";

let t: TestApp;
let port: number;
let alice: TestUser;
let bob: TestUser;
const sockets: TestSocket[] = [];

async function connect(user?: TestUser, origin?: string) {
  const s = await TestSocket.connect(port, user?.cookie, origin);
  sockets.push(s);
  return s;
}

beforeEach(async () => {
  t = await createTestApp();
  alice = await registerUser(t, "member", "alice");
  bob = await registerUser(t, "member", "bob");
  port = await listen(t);
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  await t.close();
});

describe("conexão", () => {
  it("sem sessão é recusada", async () => {
    const s = await connect();
    expect(await s.waitClose()).toBe(WS_CLOSE_UNAUTHORIZED);
  });

  it("de outro site é recusada (CSWSH)", async () => {
    const s = await connect(alice, "https://site-malicioso.com");
    expect(await s.waitClose()).toBe(WS_CLOSE_UNAUTHORIZED);
  });

  it("envia o estado inicial completo", async () => {
    const s = await connect(alice);
    const hello = await s.waitFor("hello");
    expect(hello.me.username).toBe("alice");
    expect(hello.users.map((u) => u.username).sort()).toEqual(["alice", "bob"]);
    expect(hello.channels.length).toBeGreaterThan(0);
    expect(hello.online).toContain(alice.id);
    expect(hello.serverTime).toBeTypeOf("number");
  });

  it("responde ping com o horário do servidor", async () => {
    const s = await connect(alice);
    s.send({ type: "ping", t0: 123 });
    const pong = await s.waitFor("pong");
    expect(pong.t0).toBe(123);
  });

  it("ignora mensagens inválidas sem derrubar a conexão", async () => {
    const s = await connect(alice);
    await s.waitFor("hello");
    s.ws.send("isso não é json");
    s.send({ type: "inexistente" });
    s.send({ type: "voice.join" });
    s.send({ type: "ping", t0: 1 });
    await s.waitFor("pong");
    expect(s.closeCode).toBeNull();
  });
});

describe("presença e chat", () => {
  it("avisa quando alguém entra e sai", async () => {
    const a = await connect(alice);
    await a.waitFor("hello");
    const b = await connect(bob);
    await a.waitFor("presence", (e) => e.userId === bob.id && e.online);
    b.close();
    await a.waitFor("presence", (e) => e.userId === bob.id && !e.online);
  });

  it("mensagem nova chega em tempo real para os outros", async () => {
    const b = await connect(bob);
    await b.waitFor("hello");
    const channel = textChannelId(t);
    await t.app.inject({
      method: "POST",
      url: `/api/channels/${channel}/messages`,
      headers: { cookie: alice.cookie },
      payload: { content: "fala, galera" },
    });
    const ev = await b.waitFor("message.create");
    expect(ev.message.content).toBe("fala, galera");
    expect(ev.message.authorId).toBe(alice.id);
  });

  it("'digitando' vai só para os outros e tem limite de frequência", async () => {
    const a = await connect(alice);
    const b = await connect(bob);
    await a.waitFor("hello");
    await b.waitFor("hello");
    const channel = textChannelId(t);
    a.send({ type: "typing", channelId: channel });
    a.send({ type: "typing", channelId: channel });
    await b.waitFor("typing", (e) => e.userId === alice.id);
    a.send({ type: "ping", t0: 1 });
    await a.waitFor("pong");
    expect(b.events.filter((e) => e.type === "typing")).toHaveLength(1);
    expect(a.events.filter((e) => e.type === "typing")).toHaveLength(0);
  });

  it("conta desativada é desconectada na hora", async () => {
    const admin = await registerUser(t, "admin");
    const b = await connect(bob);
    await b.waitFor("hello");
    await t.app.inject({ method: "POST", url: `/api/admin/users/${bob.id}/disable`, headers: { cookie: admin.cookie } });
    expect(await b.waitClose()).toBe(WS_CLOSE_SESSION_REVOKED);
  });
});

describe("rede privada", () => {
  it("quem não tem relação não aparece (lista, online e perfil); um pedido de amizade apresenta os dois", async () => {
    // cadastro aberto: sem convite, a conta nasce fora de qualquer roda
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "estranho", displayName: "Estranho", password: "senha-forte-123" },
    });
    const stranger: TestUser = { id: res.json().me.id, username: "estranho", cookie: cookieHeader(res) };

    const a = await connect(alice);
    expect((await a.waitFor("hello")).users.map((u) => u.id)).not.toContain(stranger.id);
    const s = await connect(stranger);
    const hello = await s.waitFor("hello");
    expect(hello.users.map((u) => u.id)).toEqual([stranger.id]);
    expect(hello.online).not.toContain(alice.id);

    // alice muda o perfil e o estranho não fica sabendo; alice também não vê o estranho entrar
    await t.app.inject({ method: "PATCH", url: "/api/me", headers: { cookie: alice.cookie }, payload: { note: "oi" } });
    for (const sock of [a, s]) {
      sock.send({ type: "ping", t0: 1 });
      await sock.waitFor("pong"); // o pong chega depois de tudo que o servidor já mandou
    }
    expect(s.events.some((e) => e.type === "user.upsert")).toBe(false);
    expect(a.events.some((e) => e.type === "presence" && e.userId === stranger.id)).toBe(false);

    // o admin também só vê quem conhece no app; a lista completa fica no painel (só para admin)
    const admin = await registerUser(t, "admin", "chefe");
    t.ctx.store.removeMember(t.ctx.store.defaultRodaId()!, admin.id);
    const adm = await connect(admin);
    expect((await adm.waitFor("hello")).users.map((u) => u.id)).not.toContain(stranger.id);
    const all = await t.app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: admin.cookie } });
    expect(all.json().users.map((u: { id: string }) => u.id)).toContain(stranger.id);
    expect((await t.app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: alice.cookie } })).statusCode).toBe(403);

    // pedido de amizade pelo nome: os dois passam a se ver, com o online
    await t.app.inject({ method: "POST", url: "/api/friends", headers: { cookie: stranger.cookie }, payload: { who: "alice" } });
    expect((await a.waitFor("user.upsert", (e) => e.user.id === stranger.id)).user.username).toBe("estranho");
    expect((await a.waitFor("presence", (e) => e.userId === stranger.id)).online).toBe(true);
    expect((await s.waitFor("user.upsert", (e) => e.user.id === alice.id)).user.username).toBe("alice");
  });
});

describe("voz", () => {
  it("token só para canal de voz", async () => {
    const ok = await t.app.inject({
      method: "POST",
      url: "/api/voice/token",
      headers: { cookie: alice.cookie, host: "resenha.exemplo.com" },
      payload: { channelId: voiceChannelId(t) },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().url).toBe("ws://resenha.exemplo.com");
    expect(ok.json().token).toContain(alice.id);

    const bad = await t.app.inject({
      method: "POST",
      url: "/api/voice/token",
      headers: { cookie: alice.cookie },
      payload: { channelId: textChannelId(t) },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("todos veem quem entrou, os estados e quem saiu (inclusive se a aba fechar)", async () => {
    const voice = voiceChannelId(t);
    const a = await connect(alice);
    const b = await connect(bob);
    await b.waitFor("hello");

    a.send({ type: "voice.join", channelId: voice });
    let ev = await b.waitFor("voice.channel", (e) => e.members.length === 1);
    expect(ev.members[0]!.userId).toBe(alice.id);

    a.send({ type: "voice.flags", muted: true, deafened: false, streaming: true, video: false });
    ev = await b.waitFor("voice.channel", (e) => e.members[0]?.muted === true);
    expect(ev.members[0]!.streaming).toBe(true);

    a.close();
    await b.waitFor("voice.channel", (e) => e.channelId === voice && e.members.length === 0);
  });

  it("trocar de canal remove do anterior", async () => {
    const [v1, v2] = [voiceChannelId(t, 0), voiceChannelId(t, 1)];
    const a = await connect(alice);
    await a.waitFor("hello");
    a.send({ type: "voice.join", channelId: v1 });
    await a.waitFor("voice.channel", (e) => e.channelId === v1 && e.members.length === 1);
    a.send({ type: "voice.join", channelId: v2 });
    await a.waitFor("voice.channel", (e) => e.channelId === v1 && e.members.length === 0);
    await a.waitFor("voice.channel", (e) => e.channelId === v2 && e.members.length === 1);
  });

  it("apagar o canal tira todo mundo e derruba a chamada", async () => {
    const admin = await registerUser(t, "admin");
    const voice = voiceChannelId(t);
    const a = await connect(alice);
    a.send({ type: "voice.join", channelId: voice });
    await a.waitFor("voice.channel", (e) => e.members.length === 1);
    await t.app.inject({ method: "DELETE", url: `/api/channels/${voice}`, headers: { cookie: admin.cookie } });
    await a.waitFor("channel.remove", (e) => e.channelId === voice);
    expect(t.gateway.kicked).toEqual([{ userId: alice.id, channelId: voice }]);
  });
});

describe("assistir juntos", () => {
  const VIDEO = "https://youtu.be/dQw4w9WgXcQ";

  it("só quem está no canal de voz controla", async () => {
    const a = await connect(alice);
    await a.waitFor("hello");
    a.send({ type: "watch", channelId: voiceChannelId(t), action: { kind: "add", url: VIDEO } });
    const notice = await a.waitFor("notice");
    expect(notice.level).toBe("error");
  });

  it("adicionar sincroniza para todos, com título do oEmbed", async () => {
    const voice = voiceChannelId(t);
    const a = await connect(alice);
    const b = await connect(bob);
    await b.waitFor("hello");
    a.send({ type: "voice.join", channelId: voice });
    await a.waitFor("voice.channel", (e) => e.members.length === 1);

    a.send({ type: "watch", channelId: voice, action: { kind: "add", url: VIDEO } });
    const ev = await b.waitFor("watch.state");
    expect(ev.state.current).toMatchObject({ videoId: "dQw4w9WgXcQ", title: "Título dQw4w9WgXcQ", addedBy: alice.id });
    expect(ev.state.playing).toBe(true);
  });

  it("vídeo que não permite incorporar é recusado com aviso", async () => {
    t.titles.set("dQw4w9WgXcQ", { ok: false, reason: "not_embeddable" });
    const voice = voiceChannelId(t);
    const a = await connect(alice);
    a.send({ type: "voice.join", channelId: voice });
    await a.waitFor("voice.channel", (e) => e.members.length === 1);
    a.send({ type: "watch", channelId: voice, action: { kind: "add", url: VIDEO } });
    expect((await a.waitFor("notice")).text).toMatch(/não permite/);
    expect(t.ctx.watch.get(voice).current).toBeNull();
  });

  it("encerra quando a call esvazia: quem volta encontra a sala limpa", async () => {
    const voice = voiceChannelId(t);
    const a = await connect(alice);
    a.send({ type: "voice.join", channelId: voice });
    await a.waitFor("voice.channel", (e) => e.members.length === 1);
    a.send({ type: "watch", channelId: voice, action: { kind: "add", url: VIDEO } });
    await a.waitFor("watch.state", (e) => e.state.sessionId !== null);
    a.send({ type: "voice.leave" });
    await a.waitFor("watch.state", (e) => e.state.current === null && e.state.sessionId === null);

    const b = await connect(bob);
    const hello = await b.waitFor("hello");
    expect(hello.watch[voice]).toBeUndefined();
  });

  it("com gente na call, quem sai não encerra para os outros", async () => {
    const voice = voiceChannelId(t);
    const a = await connect(alice);
    const b = await connect(bob);
    a.send({ type: "voice.join", channelId: voice });
    b.send({ type: "voice.join", channelId: voice });
    await a.waitFor("voice.channel", (e) => e.members.length === 2);
    a.send({ type: "watch", channelId: voice, action: { kind: "add", url: VIDEO } });
    await b.waitFor("watch.state", (e) => e.state.current !== null);
    a.send({ type: "voice.leave" });
    await b.waitFor("voice.channel", (e) => e.members.length === 1);
    expect(t.ctx.watch.get(voice).current?.videoId).toBe("dQw4w9WgXcQ");
    expect(t.ctx.watch.get(voice).playing).toBe(true);
  });

  it("encerrar para todos (clear) some com o player de todo mundo", async () => {
    const voice = voiceChannelId(t);
    const a = await connect(alice);
    const b = await connect(bob);
    a.send({ type: "voice.join", channelId: voice });
    b.send({ type: "voice.join", channelId: voice });
    await a.waitFor("voice.channel", (e) => e.members.length === 2);
    a.send({ type: "watch", channelId: voice, action: { kind: "add", url: VIDEO } });
    await b.waitFor("watch.state", (e) => e.state.current !== null);
    b.send({ type: "watch", channelId: voice, action: { kind: "clear" } });
    const ev = await a.waitFor("watch.state", (e) => e.state.current === null);
    expect(ev.state.sessionId).toBeNull();
  });
});
