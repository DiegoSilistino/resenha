import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { base32, totpCode, totpStep, verifyTotp } from "../src/auth/totp.ts";
import type { Mailer } from "../src/mail.ts";
import { cookieHeader, createTestApp, listen, registerUser, textChannelId, TestSocket, type TestApp, type TestUser } from "./helpers.ts";

const PASSWORD = "senha-forte-123";

describe("código do app autenticador (RFC 6238)", () => {
  // vetores oficiais da RFC, com o segredo ASCII "12345678901234567890" (os 6 últimos dígitos)
  const secret = base32(Buffer.from("12345678901234567890"));
  it("bate com os valores da RFC", () => {
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(totpCode(secret, totpStep(59_000))).toBe("287082");
    expect(totpCode(secret, totpStep(1_111_111_109_000))).toBe("081804");
    expect(totpCode(secret, totpStep(1_234_567_890_000))).toBe("005924");
  });
  it("aceita o passo vizinho (relógio um pouco fora) e recusa o resto", () => {
    const now = 1_234_567_890_000;
    expect(verifyTotp(secret, totpCode(secret, totpStep(now) - 1), now)).toBe(totpStep(now) - 1);
    expect(verifyTotp(secret, totpCode(secret, totpStep(now) - 3), now)).toBeNull();
    expect(verifyTotp(secret, "12a456", now)).toBeNull();
  });
});

let t: TestApp;
let ana: TestUser;
let bia: TestUser;
let sent: { to: string; subject: string; text: string }[];
const mailer: Mailer = { send: async (to, subject, text) => void sent.push({ to, subject, text }) };
const lastCode = () => /\b(\d{6})\b/.exec(sent.at(-1)?.text ?? "")?.[1] ?? "";

beforeEach(async () => {
  sent = [];
  t = await createTestApp({ mailer });
  ana = await registerUser(t, "member", "ana");
  bia = await registerUser(t, "member", "bia");
});
afterEach(async () => t.close());

const call = (u: TestUser | null, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object) =>
  t.app.inject({ method, url, ...(u ? { headers: { cookie: u.cookie } } : {}), ...(payload ? { payload } : {}) });

async function befriend(a: TestUser, b: TestUser) {
  await call(a, "POST", "/api/friends", { who: b.username });
  await call(b, "POST", `/api/friends/${a.id}/accept`);
}

describe("bloquear", () => {
  it("desfaz a amizade e corta a conversa a dois nos dois sentidos; desbloquear libera o pedido de novo", async () => {
    await befriend(ana, bia);
    const dm = (await call(ana, "POST", "/api/conversations", { userIds: [bia.id] })).json().conversation.id as string;
    expect((await call(bia, "POST", `/api/channels/${dm}/messages`, { content: "oi" })).statusCode).toBe(201);

    expect((await call(ana, "PUT", `/api/blocks/${bia.id}`)).statusCode).toBe(204);
    expect(t.ctx.store.areFriends(ana.id, bia.id)).toBe(false);
    expect(t.ctx.store.blockedIds(ana.id)).toEqual([bia.id]);
    for (const u of [ana, bia]) {
      const res = await call(u, "POST", `/api/channels/${dm}/messages`, { content: "e aí" });
      expect(res.statusCode).toBe(403);
      expect(res.body).toMatch(/Não dá para mandar/);
      expect((await call(u, "POST", "/api/voice/token", { channelId: dm })).statusCode).toBe(400);
    }
    expect((await call(bia, "POST", "/api/friends", { who: "ana" })).statusCode).toBe(400);
    // o histórico continua legível
    expect((await call(bia, "GET", `/api/channels/${dm}/messages`)).statusCode).toBe(200);

    expect((await call(ana, "DELETE", `/api/blocks/${bia.id}`)).statusCode).toBe(204);
    expect((await call(bia, "POST", "/api/friends", { who: "ana" })).statusCode).toBe(200);
  });
});

describe("denunciar", () => {
  it("chega aos admins com o texto guardado; só admin vê, resolve e apaga a mensagem", async () => {
    const admin = await registerUser(t, "admin", "chefe");
    const socket = await TestSocket.connect(await listen(t), admin.cookie);
    expect((await socket.waitFor("hello")).openReports).toBe(0);

    const msg = (await call(ana, "POST", `/api/channels/${textChannelId(t)}/messages`, { content: "mensagem ofensiva" })).json().message;
    // a mensagem tem de ser de quem é denunciado
    expect((await call(bia, "POST", "/api/reports", { userId: admin.id, messageId: msg.id })).statusCode).toBe(404);
    expect((await call(bia, "POST", "/api/reports", { userId: ana.id, messageId: msg.id, reason: "xingou" })).statusCode).toBe(204);
    expect((await socket.waitFor("admin.reports", (e) => e.open === 1)).open).toBe(1);

    expect((await call(bia, "GET", "/api/admin/reports")).statusCode).toBe(403);
    const [report] = (await call(admin, "GET", "/api/admin/reports")).json().reports;
    expect(report).toMatchObject({ reporterId: bia.id, targetUserId: ana.id, content: "mensagem ofensiva", reason: "xingou", doneAt: null });

    expect((await call(admin, "DELETE", `/api/admin/reports/${report.id}/message`)).statusCode).toBe(204);
    expect(t.ctx.store.messageById(msg.id)).toBeNull();
    expect((await call(admin, "POST", `/api/admin/reports/${report.id}/done`)).statusCode).toBe(200);
    await socket.waitFor("admin.reports", (e) => e.open === 0);
    socket.close();
  });
});

describe("e-mail e esqueci a senha", () => {
  it("confirma o e-mail com o código e troca a senha esquecida, derrubando as sessões", async () => {
    expect((await call(ana, "POST", "/api/me/email", { email: "Ana@Exemplo.com", password: "errada" })).statusCode).toBe(400);
    expect((await call(ana, "POST", "/api/me/email", { email: "Ana@Exemplo.com", password: PASSWORD })).statusCode).toBe(200);
    expect(sent.at(-1)?.to).toBe("ana@exemplo.com");
    const security = (await call(ana, "POST", "/api/me/email/confirm", { code: lastCode() })).json();
    expect(security).toMatchObject({ email: "ana@exemplo.com", pendingEmail: null, mailEnabled: true });
    // o mesmo e-mail não entra em outra conta
    expect((await call(bia, "POST", "/api/me/email", { email: "ana@exemplo.com", password: PASSWORD })).statusCode).toBe(409);

    // e-mail desconhecido: mesma resposta, nenhum envio
    const before = sent.length;
    expect((await call(null, "POST", "/api/auth/forgot", { email: "ninguem@exemplo.com" })).statusCode).toBe(204);
    expect(sent.length).toBe(before);

    expect((await call(null, "POST", "/api/auth/forgot", { email: "ana@exemplo.com" })).statusCode).toBe(204);
    await new Promise((r) => setTimeout(r, 10)); // o envio não é esperado pela resposta
    const code = lastCode();
    const reset = (password: string, c = code) => call(null, "POST", "/api/auth/reset", { email: "ana@exemplo.com", code: c, password });
    expect((await reset("senha-nova-123", code === "000000" ? "111111" : "000000")).statusCode).toBe(400);
    expect((await reset("senha-nova-123")).statusCode).toBe(204);
    expect((await call(ana, "GET", "/api/auth/me")).statusCode).toBe(401); // a sessão antiga caiu
    expect((await reset("outra-senha-123")).statusCode).toBe(400); // o código só vale uma vez
    const login = await call(null, "POST", "/api/auth/login", { username: "ana", password: "senha-nova-123" });
    expect(login.statusCode).toBe(200);
  });

  it("depois de 5 códigos errados, nem o certo vale mais", async () => {
    await call(ana, "POST", "/api/me/email", { email: "ana@exemplo.com", password: PASSWORD });
    const right = lastCode();
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await call(ana, "POST", "/api/me/email/confirm", { code: wrong });
    const res = await call(ana, "POST", "/api/me/email/confirm", { code: right });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatch(/expirado/);
  });

  it("cadastro com e-mail já manda o código", async () => {
    const res = await call(null, "POST", "/api/auth/register", {
      username: "caio",
      displayName: "Caio",
      password: PASSWORD,
      email: "caio@exemplo.com",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().emailPending).toBe(true);
    expect(sent.at(-1)?.to).toBe("caio@exemplo.com");
  });
});

describe("verificação em duas etapas", () => {
  it("liga com um código do app; o login pede o código; o de reserva vale uma vez", async () => {
    const { secret } = (await call(ana, "POST", "/api/me/2fa/setup", { password: PASSWORD })).json();
    const now = totpStep();
    const enable = await call(ana, "POST", "/api/me/2fa/enable", { code: totpCode(secret, now) });
    expect(enable.statusCode).toBe(200);
    const { recoveryCodes } = enable.json() as { recoveryCodes: string[] };
    expect(recoveryCodes).toHaveLength(10);

    const login = (await call(null, "POST", "/api/auth/login", { username: "ana", password: PASSWORD })).json();
    expect(login).toMatchObject({ twoFactor: true });
    expect(login.me).toBeUndefined();
    const second = (code: string) => call(null, "POST", "/api/auth/login/2fa", { ticket: login.ticket, code });
    // o código que ligou a verificação já foi usado: não entra de novo
    expect((await second(totpCode(secret, now))).statusCode).toBe(400);
    const ok = await second(recoveryCodes[0]!.toUpperCase());
    expect(ok.statusCode).toBe(200);
    expect(ok.json().me.username).toBe("ana");
    expect(cookieHeader(ok)).toContain("=");

    // o código de reserva some depois de usado
    const again = (await call(null, "POST", "/api/auth/login", { username: "ana", password: PASSWORD })).json();
    const reuse = await call(null, "POST", "/api/auth/login/2fa", { ticket: again.ticket, code: recoveryCodes[0] });
    expect(reuse.statusCode).toBe(400);

    // admin desliga para quem perdeu o celular
    const admin = await registerUser(t, "admin", "chefe");
    const users = (await call(admin, "GET", "/api/admin/users")).json().users as { username: string; twoFactor: boolean }[];
    expect(users.find((u) => u.username === "ana")?.twoFactor).toBe(true);
    expect((await call(admin, "POST", `/api/admin/users/${ana.id}/2fa/disable`)).statusCode).toBe(204);
    expect((await call(null, "POST", "/api/auth/login", { username: "ana", password: PASSWORD })).json().me.username).toBe("ana");
  });
});
