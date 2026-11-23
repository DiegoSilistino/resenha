import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LOOK, PROFILE_COLORS } from "@resenha/shared";
import { createTestApp, listen, registerUser, TestSocket, type TestApp, type TestUser } from "./helpers.ts";
import { multipart } from "./images.ts";

let t: TestApp;
let alice: TestUser;
let bob: TestUser;

beforeEach(async () => {
  t = await createTestApp();
  alice = await registerUser(t, "member", "alice");
  bob = await registerUser(t, "member", "bob");
});
afterEach(async () => {
  await t.close();
});

const patchMe = (user: TestUser, body: unknown) =>
  t.app.inject({ method: "PATCH", url: "/api/me", headers: { cookie: user.cookie }, payload: body as object });

/** GIF mínimo: só o cabeçalho que o servidor lê (assinatura e tamanho). */
const gif = (w: number, h: number) => {
  const head = Buffer.alloc(10);
  head.write("GIF89a", 0, "latin1");
  head.writeUInt16LE(w, 6);
  head.writeUInt16LE(h, 8);
  return Buffer.concat([head, Buffer.alloc(32)]);
};

describe("perfil: status, atividade, recado e visual", () => {
  it("salva e todos recebem em tempo real", async () => {
    const port = await listen(t);
    const bobSocket = await TestSocket.connect(port, bob.cookie);
    await bobSocket.waitFor("hello");

    const look = { ...DEFAULT_LOOK, a: PROFILE_COLORS[2]!, frame: "halo", nickStyle: "gradiente", font: "serif" };
    const res = await patchMe(alice, { status: "ocupado", activity: "  Jogando\n CS2 ", note: "não chama na ranked", look });
    expect(res.statusCode).toBe(200);
    const { me } = res.json();
    expect(me).toMatchObject({ status: "ocupado", activity: "Jogando CS2", note: "não chama na ranked", look });

    const upsert = await bobSocket.waitFor("user.upsert", (e) => e.user.id === alice.id);
    expect(upsert.user.look).toEqual(look);
    bobSocket.close();
  });

  it("recusa cor fora da paleta e texto longo demais", async () => {
    expect((await patchMe(alice, { look: { ...DEFAULT_LOOK, a: "red" } })).statusCode).toBe(400);
    expect((await patchMe(alice, { activity: "x".repeat(61) })).statusCode).toBe(400);
    expect((await patchMe(alice, { status: "dormindo" })).statusCode).toBe(400);
  });

  it("invisível: os outros veem a pessoa sair e ela não aparece online para quem chega", async () => {
    const port = await listen(t);
    const aliceSocket = await TestSocket.connect(port, alice.cookie);
    await aliceSocket.waitFor("hello");
    const bobSocket = await TestSocket.connect(port, bob.cookie);
    expect((await bobSocket.waitFor("hello")).online).toContain(alice.id);

    await patchMe(alice, { status: "invisivel" });
    expect((await bobSocket.waitFor("presence", (e) => e.userId === alice.id)).online).toBe(false);

    const late = await TestSocket.connect(port, bob.cookie);
    expect((await late.waitFor("hello")).online).not.toContain(alice.id);

    await patchMe(alice, { status: "online" });
    expect((await bobSocket.waitFor("presence", (e) => e.userId === alice.id && e.online)).online).toBe(true);
    for (const s of [aliceSocket, bobSocket, late]) s.close();
  });
});

describe("capa do perfil", () => {
  const sendBanner = (user: TestUser, content: Buffer, filename = "capa.gif") => {
    const { payload, headers } = multipart(filename, content);
    return t.app.inject({ method: "POST", url: "/api/me/banner", headers: { ...headers, cookie: user.cookie }, payload });
  };

  it("aceita GIF, entrega com o tipo certo e não é apagada na limpeza de arquivos soltos", async () => {
    const res = await sendBanner(alice, gif(600, 200));
    expect(res.statusCode).toBe(200);
    const url = res.json().me.bannerUrl as string;
    expect(url).toMatch(/^\/api\/banners\/[0-9a-f-]{36}$/);
    expect(t.ctx.store.allAvatarIds().has(url.split("/").pop()!)).toBe(true);

    const file = await t.app.inject({ method: "GET", url, headers: { cookie: bob.cookie } });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/gif");
    expect(String(file.headers["content-security-policy"])).toContain("sandbox");

    const removed = await t.app.inject({ method: "DELETE", url: "/api/me/banner", headers: { cookie: alice.cookie } });
    expect(removed.json().me.bannerUrl).toBeNull();
  });

  it("recusa o que não é imagem", async () => {
    expect((await sendBanner(alice, Buffer.from("<svg onload=alert(1)>"), "capa.svg")).statusCode).toBe(400);
  });
});
