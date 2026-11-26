import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, listen, registerUser, TestSocket, type TestApp, type TestUser } from "./helpers.ts";
import { multipart, png } from "./images.ts";

let t: TestApp;
let ana: TestUser;
let bia: TestUser;
beforeEach(async () => {
  t = await createTestApp();
  ana = await registerUser(t, "member", "ana");
  bia = await registerUser(t, "member", "bia");
});
afterEach(async () => t.close());

const create = (u: TestUser, img: Buffer) => {
  const { payload, headers } = multipart("figurinha.png", img);
  return t.app.inject({ method: "POST", url: "/api/stickers", headers: { ...headers, cookie: u.cookie }, payload });
};
const favorite = (u: TestUser, method: "PUT" | "DELETE", id: string) =>
  t.app.inject({ method, url: `/api/stickers/${id}`, headers: { cookie: u.cookie } });

describe("figurinhas pessoais", () => {
  it("cria, entra nas suas, a imagem sai pela rota das fotos e a limpeza não apaga", async () => {
    const res = await create(ana, png(320, 320));
    expect(res.statusCode).toBe(201);
    const { id } = res.json();
    expect(t.ctx.store.myStickerIds(ana.id)).toEqual([id]);
    const img = await t.app.inject({ method: "GET", url: `/api/avatars/${id}`, headers: { cookie: bia.cookie } });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(t.ctx.store.allAvatarIds().has(id)).toBe(true);
  });

  it("recusa o que não é imagem", async () => {
    expect((await create(ana, Buffer.from("<svg onload=alert(1)>"))).statusCode).toBe(400);
  });

  it("favoritar a de outra pessoa (e tirar) avisa os aparelhos dela; quem criou continua com a sua", async () => {
    const { id } = (await create(ana, png(320, 320))).json();
    const socket = await TestSocket.connect(await listen(t), bia.cookie);
    expect((await socket.waitFor("hello")).stickers).toEqual([]);

    expect((await favorite(bia, "PUT", id)).statusCode).toBe(204);
    expect((await socket.waitFor("stickers", (e) => e.ids.length === 1)).ids).toEqual([id]);
    expect((await favorite(bia, "DELETE", id)).statusCode).toBe(204);
    await socket.waitFor("stickers", (e) => e.ids.length === 0);

    expect(t.ctx.store.myStickerIds(ana.id)).toEqual([id]);
    expect((await favorite(bia, "PUT", "00000000-0000-0000-0000-000000000000")).statusCode).toBe(404);
    socket.close();
  });
});
