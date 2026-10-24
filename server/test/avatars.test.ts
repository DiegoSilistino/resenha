import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "@resenha/shared";
import { createTestApp, listen, registerUser, TestSocket, type TestApp, type TestUser } from "./helpers.ts";
import { multipart, png, webpExtended, webpLossless } from "./images.ts";

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

const sendAvatar = (user: TestUser, content: Buffer, filename = "foto.webp") => {
  const { payload, headers } = multipart(filename, content);
  return t.app.inject({ method: "POST", url: "/api/me/avatar", headers: { ...headers, cookie: user.cookie }, payload });
};

describe("foto de perfil", () => {
  it("envia, todos veem em tempo real, e a URL entrega a imagem com cabeçalhos seguros", async () => {
    const port = await listen(t);
    const bobSocket = await TestSocket.connect(port, bob.cookie);
    await bobSocket.waitFor("hello");

    const image = webpLossless(256, 256);
    const res = await sendAvatar(alice, image);
    expect(res.statusCode).toBe(200);
    const { me } = res.json();
    expect(me.avatarUrl).toMatch(/^\/api\/avatars\/[0-9a-f-]{36}$/);

    const upsert = await bobSocket.waitFor("user.upsert", (e) => e.user.id === alice.id);
    expect(upsert.user.avatarUrl).toBe(me.avatarUrl);

    const file = await t.app.inject({ method: "GET", url: me.avatarUrl, headers: { cookie: bob.cookie } });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/webp");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(file.headers["content-security-policy"])).toContain("sandbox");
    expect(String(file.headers["cache-control"])).toContain("immutable");
    expect(file.rawPayload.equals(image)).toBe(true);
    bobSocket.close();
  });

  it("exige login para ver a foto", async () => {
    const { me } = (await sendAvatar(alice, png(64, 64))).json();
    expect((await t.app.inject({ method: "GET", url: me.avatarUrl })).statusCode).toBe(401);
  });

  it("trocar apaga a foto antiga do disco; remover volta para as iniciais", async () => {
    const first = (await sendAvatar(alice, png(64, 64))).json().me.avatarUrl as string;
    const firstFile = t.ctx.avatars.pathFor(first.split("/").pop()!);
    expect(existsSync(firstFile)).toBe(true);

    const second = (await sendAvatar(alice, webpLossless(128, 128))).json().me.avatarUrl as string;
    expect(second).not.toBe(first);
    expect(existsSync(firstFile)).toBe(false);
    expect((await t.app.inject({ method: "GET", url: first, headers: { cookie: bob.cookie } })).statusCode).toBe(404);

    const removed = await t.app.inject({ method: "DELETE", url: "/api/me/avatar", headers: { cookie: alice.cookie } });
    expect(removed.json().me.avatarUrl).toBeNull();
    expect(existsSync(t.ctx.avatars.pathFor(second.split("/").pop()!))).toBe(false);
  });

  it("recusa o que não é foto parada de tamanho razoável", async () => {
    const html = await sendAvatar(alice, Buffer.from("<html><script>alert(1)</script></html>"), "foto.png");
    expect(html.statusCode).toBe(400);
    expect((await sendAvatar(alice, webpExtended(5000, 5000))).statusCode).toBe(400); // bomba de descompressão
    expect((await sendAvatar(alice, png(8, 8))).statusCode).toBe(400);
    expect((await sendAvatar(alice, png(64, 64, { animated: true }))).json().error).toMatch(/animada/);
    const huge = Buffer.concat([png(64, 64), Buffer.alloc(LIMITS.avatarMaxBytes)]);
    expect((await sendAvatar(alice, huge)).statusCode).toBe(413);
    expect(t.ctx.store.allAvatarIds().size).toBe(0);
  });
});
