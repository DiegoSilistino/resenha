import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "@resenha/shared";
import { makeSnippet, searchTerms, ftsQuery } from "../src/search.ts";
import { audioMime } from "../src/uploads/audio.ts";
import { createTestApp, listen, registerUser, textChannelId, TestSocket, voiceChannelId, type TestApp, type TestUser } from "./helpers.ts";
import { multipart } from "./images.ts";

let t: TestApp;
let admin: TestUser;
let ana: TestUser;
beforeEach(async () => {
  t = await createTestApp();
  admin = await registerUser(t, "admin", "chefe");
  ana = await registerUser(t, "member", "ana");
});
afterEach(async () => t.close());

const post = (u: TestUser, content: string, ch = textChannelId(t)) =>
  t.app.inject({ method: "POST", url: `/api/channels/${ch}/messages`, headers: { cookie: u.cookie }, payload: { content } });
const search = (u: TestUser, q: string, extra = "") =>
  t.app.inject({ method: "GET", url: `/api/search?q=${encodeURIComponent(q)}${extra}`, headers: { cookie: u.cookie } });

describe("busca de mensagens", () => {
  it("acha sem acento, sem maiúscula e pelo começo da palavra, com trecho marcado", async () => {
    await post(ana, "Bora jogar à noite? Levo PIZZA de calabresa");
    await post(ana, "ação e emoção no CS");
    await post(ana, "nada a ver");
    const res = (await search(admin, "pizz noite")).json();
    expect(res.results).toHaveLength(1);
    expect(res.results[0].message.content).toContain("PIZZA");
    expect(res.results[0].snippet).toContain("\u0001PIZZA\u0002");
    expect((await search(admin, "acao")).json().results[0].message.content).toBe("ação e emoção no CS");
  });

  it("filtra por canal, pagina e ignora GIFs", async () => {
    for (let i = 0; i < LIMITS.searchPageSize + 3; i++) await post(ana, `partida ${i}`);
    await post(ana, "partida no chat da voz", voiceChannelId(t));
    await post(ana, "https://media2.giphy.com/media/partida/giphy.mp4#480x270");
    const page1 = (await search(admin, "partida", `&channelId=${textChannelId(t)}`)).json();
    expect(page1.results).toHaveLength(LIMITS.searchPageSize);
    expect(page1.hasMore).toBe(true);
    const oldest = page1.results.at(-1).message.id;
    const page2 = (await search(admin, "partida", `&channelId=${textChannelId(t)}&before=${oldest}`)).json();
    expect(page2.results).toHaveLength(3);
    expect((await search(admin, "partida")).json().results[0].message.content).toBe("partida no chat da voz");
  });

  it("edição e exclusão atualizam o índice", async () => {
    const m = (await post(ana, "texto antigo")).json().message;
    await t.app.inject({ method: "PATCH", url: `/api/messages/${m.id}`, headers: { cookie: ana.cookie }, payload: { content: "texto novo" } });
    expect((await search(admin, "antigo")).json().results).toHaveLength(0);
    expect((await search(admin, "novo")).json().results).toHaveLength(1);
    await t.app.inject({ method: "DELETE", url: `/api/messages/${m.id}`, headers: { cookie: ana.cookie } });
    expect((await search(admin, "novo")).json().results).toHaveLength(0);
  });

  it("aspas e símbolos não quebram a consulta; pede 2 letras", async () => {
    await post(ana, 'ele disse "oi" (e foi embora)');
    expect((await search(admin, '"oi" (e')).statusCode).toBe(200);
    expect((await search(admin, "a")).statusCode).toBe(400);
    expect(ftsQuery(searchTerms('a"b  c*'))).toBe('"ab"* "c*"*');
  });

  it("trecho de reserva (sem FTS5) marca as palavras sem acento", () => {
    expect(makeSnippet("Levo PIZZA hoje", ["pizz"])).toBe("Levo \u0001PIZZ\u0002A hoje");
  });
});

describe("painel de erros", () => {
  const report = (u: TestUser, body: object) =>
    t.app.inject({ method: "POST", url: "/api/client-errors", headers: { cookie: u.cookie, "user-agent": "Mozilla/5.0 Chrome/141" }, payload: body });

  it("guarda o erro com navegador e contexto, avisa os admins na hora e só admin lê", async () => {
    const socket = await TestSocket.connect(await listen(t), admin.cookie);
    await socket.waitFor("hello");
    expect((await report(ana, { kind: "voz", message: "A conexão de voz caiu", detail: "reason=4", context: { status: "connected", ia: true } })).statusCode).toBe(204);
    const pushed = await socket.waitFor("admin.error");
    expect(pushed.entry).toMatchObject({ kind: "voz", userId: ana.id, userAgent: "Mozilla/5.0 Chrome/141", context: { ia: true } });
    const list = await t.app.inject({ method: "GET", url: "/api/admin/errors", headers: { cookie: admin.cookie } });
    expect(list.json().errors).toHaveLength(1);
    expect((await t.app.inject({ method: "GET", url: "/api/admin/errors", headers: { cookie: ana.cookie } })).statusCode).toBe(403);
    await t.app.inject({ method: "DELETE", url: "/api/admin/errors", headers: { cookie: admin.cookie } });
    expect((await t.app.inject({ method: "GET", url: "/api/admin/errors", headers: { cookie: admin.cookie } })).json().errors).toEqual([]);
    socket.close();
  });

  it("recusa tipo desconhecido e texto gigante", async () => {
    expect((await report(ana, { kind: "hack", message: "x" })).statusCode).toBe(400);
    expect((await report(ana, { kind: "voz", message: "x".repeat(501) })).statusCode).toBe(400);
  });

  it("feedback é um canal só do criador do site: fora dos erros, aviso só para ele, outros admins não leem", async () => {
    const port = await listen(t);
    const owner = await TestSocket.connect(port, admin.cookie); // admin = primeira conta admin = criador do site
    expect((await owner.waitFor("hello")).latestFeedbackId).toBe(0);
    const outro = await registerUser(t, "admin", "outro-admin");
    const other = await TestSocket.connect(port, outro.cookie);
    expect((await other.waitFor("hello")).latestFeedbackId).toBeUndefined();

    const long = `Sugestão: ${"a".repeat(900)}`;
    expect((await report(ana, { kind: "feedback", message: long })).statusCode).toBe(204);
    expect((await report(ana, { kind: "feedback", message: "x".repeat(1_100) })).statusCode).toBe(400);
    expect((await owner.waitFor("admin.feedback")).entry).toMatchObject({ kind: "feedback", userId: ana.id, message: long });

    const get = (u: TestUser, url: string) => t.app.inject({ method: "GET", url, headers: { cookie: u.cookie } });
    expect((await get(admin, "/api/admin/errors")).json().errors).toEqual([]);
    expect((await get(admin, "/api/admin/feedback")).json().feedback[0]).toMatchObject({ message: long });
    expect((await get(outro, "/api/admin/feedback")).statusCode).toBe(403);
    expect((await get(ana, "/api/admin/feedback")).statusCode).toBe(403);

    // limpar os erros não apaga o feedback
    await t.app.inject({ method: "DELETE", url: "/api/admin/errors", headers: { cookie: admin.cookie } });
    expect((await get(admin, "/api/admin/feedback")).json().feedback).toHaveLength(1);
    owner.close();
    other.close();
  });

  it("o hello do admin traz o último erro (acende o aviso); o do membro não", async () => {
    const port = await listen(t);
    await report(ana, { kind: "tela", message: "Falhou ao transmitir" });
    const latest = t.ctx.store.latestClientErrorId();
    expect(latest).toBeGreaterThan(0);
    const adm = await TestSocket.connect(port, admin.cookie);
    const mem = await TestSocket.connect(port, ana.cookie);
    expect((await adm.waitFor("hello")).latestErrorId).toBe(latest);
    expect((await mem.waitFor("hello")).latestErrorId).toBeUndefined();
    // Limpar zera o "último": o navegador do admin volta o "visto" junto.
    t.ctx.store.clearClientErrors();
    expect(t.ctx.store.latestClientErrorId()).toBe(0);
    adm.close();
    mem.close();
  });

  it("guarda só os 500 mais recentes", async () => {
    for (let i = 0; i < 510; i++) t.ctx.store.insertClientError({ userId: ana.id, kind: "inesperado", message: `e${i}`, detail: "", userAgent: "", context: {} });
    const all = t.ctx.store.listClientErrors(1000);
    expect(all).toHaveLength(500);
    expect(all[0]!.message).toBe("e509");
  });
});

describe("mesa de sons", () => {
  const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(200, 3)]);
  const upload = (u: TestUser, content: Buffer, name = "Risada", emoji = "😂", personal = false) => {
    const { payload, headers } = multipart("som.ogg", content);
    return t.app.inject({
      method: "POST",
      url: `/api/sounds?name=${encodeURIComponent(name)}&emoji=${encodeURIComponent(emoji)}${personal ? "&personal=1" : ""}`,
      headers: { ...headers, cookie: u.cookie },
      payload,
    });
  };

  it("envia, todos recebem a lista nova e o arquivo sai com tipo certo", async () => {
    const socket = await TestSocket.connect(await listen(t), admin.cookie);
    await socket.waitFor("hello");
    const res = await upload(ana, OGG);
    expect(res.statusCode).toBe(201);
    const { sound } = res.json();
    expect(sound).toMatchObject({ name: "Risada", emoji: "😂", uploaderId: ana.id });
    expect((await socket.waitFor("sound.upsert")).sound.id).toBe(sound.id);
    const file = await t.app.inject({ method: "GET", url: sound.url, headers: { cookie: admin.cookie } });
    expect(file.headers["content-type"]).toBe("audio/ogg");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    socket.close();
  });

  it("recusa o que não é áudio, nome vazio e emoji inválido", async () => {
    expect((await upload(ana, Buffer.from("<html>nada de áudio</html>"))).statusCode).toBe(400);
    expect((await upload(ana, OGG, "")).statusCode).toBe(400);
    expect((await upload(ana, OGG, "ok", "kkk")).statusCode).toBe(400);
    expect((await upload(ana, Buffer.concat([OGG, Buffer.alloc(LIMITS.soundMaxBytes)]))).statusCode).toBe(413);
  });

  it("só quem enviou ou admin apaga", async () => {
    const { sound } = (await upload(ana, OGG)).json();
    const bia = await registerUser(t, "member", "bia");
    expect((await t.app.inject({ method: "DELETE", url: sound.url, headers: { cookie: bia.cookie } })).statusCode).toBe(403);
    expect((await t.app.inject({ method: "DELETE", url: sound.url, headers: { cookie: admin.cookie } })).statusCode).toBe(204);
    expect(t.ctx.store.listSounds()).toEqual([]);
  });

  it("tocar: só quem está na call toca, só a call ouve, e com intervalo mínimo", async () => {
    const { sound } = (await upload(ana, OGG)).json();
    const port = await listen(t);
    const voice = voiceChannelId(t);
    const a = await TestSocket.connect(port, ana.cookie);
    const b = await TestSocket.connect(port, admin.cookie);
    const bia = await registerUser(t, "member", "bia");
    const c = await TestSocket.connect(port, bia.cookie); // fora da call
    for (const s of [a, b, c]) await s.waitFor("hello");

    a.send({ type: "soundboard.play", channelId: voice, soundId: sound.id });
    expect((await a.waitFor("notice")).text).toMatch(/Entre no canal de voz/);

    a.send({ type: "voice.join", channelId: voice });
    b.send({ type: "voice.join", channelId: voice });
    await b.waitFor("voice.channel", (e) => e.members.length === 2);
    a.send({ type: "soundboard.play", channelId: voice, soundId: sound.id });
    a.send({ type: "soundboard.play", channelId: voice, soundId: sound.id }); // rápido demais: ignorado
    expect(await b.waitFor("soundboard.played")).toMatchObject({ soundId: sound.id, userId: ana.id });
    await new Promise((r) => setTimeout(r, 200));
    expect(b.events.filter((e) => e.type === "soundboard.played")).toHaveLength(1);
    expect(c.events.some((e) => e.type === "soundboard.played")).toBe(false);
    for (const s of [a, b, c]) s.close();
  });

  it("mesa pessoal: só quem enviou vê e toca, e a chamada toda ouve", async () => {
    const port = await listen(t);
    const a = await TestSocket.connect(port, ana.cookie);
    const b = await TestSocket.connect(port, admin.cookie);
    for (const s of [a, b]) await s.waitFor("hello");
    const res = await upload(ana, OGG, "Meu", "🎺", true);
    expect(res.statusCode).toBe(201);
    const { sound } = res.json();
    expect(sound.personal).toBe(true);
    expect((await a.waitFor("sound.upsert")).sound.id).toBe(sound.id);
    expect(t.ctx.store.listSounds(admin.id)).toEqual([]);
    expect(t.ctx.store.listSounds(ana.id).map((s) => s.id)).toEqual([sound.id]);

    const voice = voiceChannelId(t);
    a.send({ type: "voice.join", channelId: voice });
    b.send({ type: "voice.join", channelId: voice });
    await b.waitFor("voice.channel", (e) => e.members.length === 2);
    b.send({ type: "soundboard.play", channelId: voice, soundId: sound.id }); // o som não é dele: ignorado
    a.send({ type: "soundboard.play", channelId: voice, soundId: sound.id });
    expect(await b.waitFor("soundboard.played")).toMatchObject({ userId: ana.id, sound: { id: sound.id, emoji: "🎺" } });
    await new Promise((r) => setTimeout(r, 200));
    expect(b.events.filter((e) => e.type === "soundboard.played")).toHaveLength(1);
    expect(b.events.some((e) => e.type === "sound.upsert")).toBe(false);
    for (const s of [a, b]) s.close();
  });

  it("reconhece os formatos de áudio comuns", () => {
    expect(audioMime(Buffer.concat([Buffer.from("ID3"), Buffer.alloc(20)]))).toBe("audio/mpeg");
    expect(audioMime(Buffer.from([0xff, 0xfb, 0x90, 0x64, ...Array(12).fill(0)]))).toBe("audio/mpeg");
    expect(audioMime(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(8)]))).toBe("audio/wav");
    expect(audioMime(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypM4A "), Buffer.alloc(8)]))).toBe("audio/mp4");
    expect(audioMime(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Array(12).fill(0)]))).toBe("audio/webm");
    expect(audioMime(Buffer.from("GIF89a nada de som"))).toBeNull();
  });
});

describe("pular para mensagem antiga", () => {
  const list = (u: TestUser, qs: string) =>
    t.app.inject({ method: "GET", url: `/api/channels/${textChannelId(t)}/messages?${qs}`, headers: { cookie: u.cookie } });

  it("traz de uma vez a faixa contínua até a mensagem, com contexto antes dela", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 180; i++) ids.push((await post(ana, `msg ${i}`)).json().message.id);
    const target = ids[30]!;
    const before = ids[130]!; // como se a tela já tivesse da 130 em diante
    const res = (await list(admin, `before=${before}&since=${target}`)).json();
    const got = res.messages.map((m: { id: number }) => m.id);
    expect(got).toEqual(ids.slice(10, 130)); // 20 de contexto + da 30 até a 129, em ordem
    expect(res.hasMore).toBe(true);
  });

  it("perto do começo do canal avisa que não há mais nada antes", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 12; i++) ids.push((await post(ana, `m ${i}`)).json().message.id);
    const res = (await list(admin, `before=${ids[8]}&since=${ids[2]}`)).json();
    expect(res.messages.map((m: { id: number }) => m.id)).toEqual(ids.slice(0, 8));
    expect(res.hasMore).toBe(false);
  });

  it("faixa grande demais devolve só as mais novas (a procurada não vem)", () => {
    for (let i = 0; i < 30; i++) t.ctx.store.createMessage({ channelId: textChannelId(t), authorId: ana.id, content: `x${i}`, attachmentIds: [], replyTo: null });
    const all = t.ctx.store.listMessages(textChannelId(t), undefined, 100);
    const r = t.ctx.store.listMessagesSince(textChannelId(t), undefined, all[0]!.id, 10);
    expect(r.messages.map((m) => m.id)).toEqual(all.slice(-10).map((m) => m.id));
    expect(r.hasMore).toBe(true);
  });
});
