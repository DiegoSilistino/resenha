import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WS_CLOSE_SESSION_REVOKED } from "@resenha/shared";
import { createTestApp, listen, registerUser, textChannelId, TestSocket, type TestApp, type TestUser } from "./helpers.ts";

let t: TestApp;
let admin: TestUser;
let dup: TestUser;
beforeEach(async () => {
  t = await createTestApp();
  admin = await registerUser(t, "admin", "chefe");
  dup = await registerUser(t, "member", "joao2");
});
afterEach(async () => t.close());

const remove = (by: TestUser, id: string) =>
  t.app.inject({ method: "DELETE", url: `/api/admin/users/${id}`, headers: { cookie: by.cookie } });
const login = (username: string) =>
  t.app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "senha-forte-123" } });

describe("remover conta", () => {
  it("derruba a pessoa na hora, impede o login e avisa todo mundo", async () => {
    const port = await listen(t);
    const watcher = await TestSocket.connect(port, admin.cookie);
    const victim = await TestSocket.connect(port, dup.cookie);
    await watcher.waitFor("hello");
    await victim.waitFor("hello");

    expect((await remove(admin, dup.id)).statusCode).toBe(204);
    const upsert = await watcher.waitFor("user.upsert", (e) => e.user.id === dup.id);
    expect(upsert.user).toMatchObject({ removed: true, disabled: true, displayName: "Ex-membro", avatarUrl: null });
    await new Promise((r) => setTimeout(r, 100));
    expect(victim.closeCode).toBe(WS_CLOSE_SESSION_REVOKED);
    expect((await login("joao2")).statusCode).toBe(401);
    // sessão antiga também morreu
    const me = await t.app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: dup.cookie } });
    expect(me.json().me).toBeNull();
    watcher.close();
    victim.close();
  });

  it("as mensagens ficam, assinadas como Ex-membro, e o nome de usuário fica livre", async () => {
    const posted = await t.app.inject({
      method: "POST",
      url: `/api/channels/${textChannelId(t)}/messages`,
      headers: { cookie: dup.cookie },
      payload: { content: "mensagem antiga", attachmentIds: [] },
    });
    expect(posted.statusCode).toBe(201);
    await remove(admin, dup.id);

    const list = await t.app.inject({ method: "GET", url: `/api/channels/${textChannelId(t)}/messages`, headers: { cookie: admin.cookie } });
    const msg = list.json().messages.find((m: { content: string }) => m.content === "mensagem antiga");
    expect(msg.authorId).toBe(dup.id);
    expect(t.ctx.store.userById(dup.id)).toMatchObject({ removed: true, displayName: "Ex-membro" });

    const again = await registerUser(t, "member", "joao2"); // o mesmo nome, outra pessoa
    expect(again.id).not.toBe(dup.id);
  });

  it("não remove a si mesmo, membro não remove ninguém e conta removida não volta", async () => {
    expect((await remove(admin, admin.id)).statusCode).toBe(400);
    expect((await remove(dup, admin.id)).statusCode).toBe(403);
    expect((await remove(admin, dup.id)).statusCode).toBe(204);
    expect((await remove(admin, dup.id)).statusCode).toBe(404);
    const enable = await t.app.inject({ method: "POST", url: `/api/admin/users/${dup.id}/enable`, headers: { cookie: admin.cookie } });
    expect(enable.statusCode).toBe(404);
    const role = await t.app.inject({
      method: "PATCH",
      url: `/api/admin/users/${dup.id}/role`,
      headers: { cookie: admin.cookie },
      payload: { role: "admin" },
    });
    expect(role.statusCode).toBe(404);
  });
});
