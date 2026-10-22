import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cookieHeader, createTestApp, registerUser, type TestApp } from "./helpers.ts";

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

const register = (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
  t.app.inject({ method: "POST", url: "/api/auth/register", payload, headers });

describe("primeira execução", () => {
  it("cria canais padrão e um convite de admin de uso único", async () => {
    const channels = t.ctx.store.listChannels();
    expect(channels.filter((c) => c.kind === "text").length).toBeGreaterThan(0);
    expect(channels.filter((c) => c.kind === "voice").length).toBeGreaterThan(0);

    const code = t.adminInviteUrl!.split("/convite/")[1]!;
    const info = await t.app.inject({ method: "GET", url: `/api/invites/${code}` });
    expect(info.json()).toEqual({ role: "admin" });

    const res = await register({ code, username: "dono", displayName: "Dono", password: "senha-forte-123" });
    expect(res.statusCode).toBe(201);
    expect(res.json().me.role).toBe("admin");

    const again = await register({ code, username: "outro", displayName: "Outro", password: "senha-forte-123" });
    expect(again.statusCode).toBe(400);
    expect((await t.app.inject({ method: "GET", url: `/api/invites/${code}` })).statusCode).toBe(404);
  });
});

describe("cadastro", () => {
  it("valida campos e devolve erro por campo", async () => {
    const res = await register({ code: "x", username: "Nome Com Espaço", displayName: "", password: "123" });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().fields)).toEqual(expect.arrayContaining(["username", "displayName", "password"]));
  });

  it("não aceita nome de usuário repetido e não gasta o convite", async () => {
    await registerUser(t, "member", "joao");
    t.ctx.store.createInvite({ code: "convite-teste", role: "member", maxUses: 1, expiresAt: null, createdBy: null });
    const res = await register({ code: "convite-teste", username: "joao", displayName: "J", password: "senha-forte-123" });
    expect(res.statusCode).toBe(409);
    expect(t.ctx.store.inviteByCode("convite-teste")!.uses).toBe(0);
  });

  it("recusa convite expirado ou revogado", async () => {
    t.ctx.store.createInvite({ code: "velho", role: "member", maxUses: 5, expiresAt: Date.now() - 1, createdBy: null });
    t.ctx.store.createInvite({ code: "revogado", role: "member", maxUses: 5, expiresAt: null, createdBy: null });
    t.ctx.store.revokeInvite("revogado");
    for (const code of ["velho", "revogado"]) {
      const res = await register({ code, username: `u-${code}`, displayName: "X", password: "senha-forte-123" });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe("login e sessão", () => {
  it("entra, consulta /me e sai", async () => {
    await registerUser(t, "member", "maria");
    const login = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "MARIA", password: "senha-forte-123" },
    });
    expect(login.statusCode).toBe(200);
    const sid = login.cookies.find((c) => c.name === "resenha_sid")!;
    expect(sid.httpOnly).toBe(true);
    expect(sid.sameSite).toBe("Lax");

    const cookie = cookieHeader(login);
    const me = await t.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.json().me.username).toBe("maria");

    await t.app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    const after = await t.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it("mesma mensagem para usuário inexistente e senha errada", async () => {
    await registerUser(t, "member", "ana");
    const wrong = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "ana", password: "errada-errada" },
    });
    const unknown = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "ninguem", password: "errada-errada" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error).toBe(unknown.json().error);
  });

  it("o banco guarda só o hash do token", async () => {
    const u = await registerUser(t);
    const token = u.cookie.split("=")[1]!;
    const rows = t.ctx.store.db.prepare("SELECT token_hash FROM sessions").all() as { token_hash: string }[];
    expect(rows.some((r) => r.token_hash === token)).toBe(false);
  });

  it("trocar a senha derruba as outras sessões, mas mantém a atual", async () => {
    const u = await registerUser(t, "member", "pedro");
    const other = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "pedro", password: "senha-forte-123" },
    });
    const otherCookie = cookieHeader(other);

    const res = await t.app.inject({
      method: "POST",
      url: "/api/me/password",
      headers: { cookie: u.cookie },
      payload: { currentPassword: "senha-forte-123", newPassword: "nova-senha-456" },
    });
    expect(res.statusCode).toBe(204);
    expect((await t.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: u.cookie } })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: otherCookie } })).statusCode).toBe(401);
  });
});

describe("segurança", () => {
  it("recusa mutações vindas de outro site (CSRF)", async () => {
    const u = await registerUser(t);
    const res = await t.app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: { cookie: u.cookie, origin: "https://site-malicioso.com", host: "localhost:3000" },
      payload: { displayName: "hackeado" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("aceita mutação do próprio domínio", async () => {
    const u = await registerUser(t);
    const res = await t.app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: { cookie: u.cookie, origin: "http://localhost:3000", host: "localhost:3000" },
      payload: { displayName: "Novo Nome" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().me.displayName).toBe("Novo Nome");
  });

  it("membro comum não acessa rotas de admin", async () => {
    const u = await registerUser(t, "member");
    for (const [method, url] of [
      ["GET", "/api/admin/invites"],
      ["POST", "/api/admin/invites"],
      ["POST", "/api/channels"],
    ] as const) {
      const res = await t.app.inject({ method, url, headers: { cookie: u.cookie }, payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });
});

describe("administração", () => {
  it("cria convite com link e permite revogar", async () => {
    const admin = await registerUser(t, "admin");
    const res = await t.app.inject({
      method: "POST",
      url: "/api/admin/invites",
      headers: { cookie: admin.cookie },
      payload: { maxUses: 3, expiresInHours: 24 },
    });
    expect(res.statusCode).toBe(201);
    const { invite } = res.json();
    expect(invite.url).toBe(`http://localhost:5173/convite/${invite.code}`);
    expect(invite.maxUses).toBe(3);

    const del = await t.app.inject({
      method: "DELETE",
      url: `/api/admin/invites/${invite.code}`,
      headers: { cookie: admin.cookie },
    });
    expect(del.statusCode).toBe(204);
    expect((await t.app.inject({ method: "GET", url: `/api/invites/${invite.code}` })).statusCode).toBe(404);
  });

  it("desativar conta derruba as sessões e impede login", async () => {
    const admin = await registerUser(t, "admin");
    const victim = await registerUser(t, "member", "zezinho");
    const res = await t.app.inject({
      method: "POST",
      url: `/api/admin/users/${victim.id}/disable`,
      headers: { cookie: admin.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect((await t.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: victim.cookie } })).statusCode).toBe(401);
    const login = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "zezinho", password: "senha-forte-123" },
    });
    expect(login.statusCode).toBe(401);
  });

  it("admin não desativa a si mesmo nem tira o próprio cargo", async () => {
    const admin = await registerUser(t, "admin");
    const disable = await t.app.inject({
      method: "POST",
      url: `/api/admin/users/${admin.id}/disable`,
      headers: { cookie: admin.cookie },
    });
    expect(disable.statusCode).toBe(400);
    const demote = await t.app.inject({
      method: "PATCH",
      url: `/api/admin/users/${admin.id}/role`,
      headers: { cookie: admin.cookie },
      payload: { role: "member" },
    });
    expect(demote.statusCode).toBe(400);
  });

  it("não deixa apagar o último canal de texto", async () => {
    const admin = await registerUser(t, "admin");
    const texts = t.ctx.store.listChannels().filter((c) => c.kind === "text");
    for (const c of texts.slice(0, -1)) {
      const r = await t.app.inject({ method: "DELETE", url: `/api/channels/${c.id}`, headers: { cookie: admin.cookie } });
      expect(r.statusCode).toBe(204);
    }
    const last = await t.app.inject({
      method: "DELETE",
      url: `/api/channels/${texts.at(-1)!.id}`,
      headers: { cookie: admin.cookie },
    });
    expect(last.statusCode).toBe(400);
  });
});
