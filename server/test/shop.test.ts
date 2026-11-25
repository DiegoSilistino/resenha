import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COINS, DEFAULT_LOOK, shopItem } from "@resenha/shared";
import { coinDay, payVoiceMinute } from "../src/routes/shop.ts";
import { createTestApp, listen, registerUser, TestSocket, voiceChannelId, type TestApp, type TestUser } from "./helpers.ts";

let t: TestApp;
let admin: TestUser;
let ana: TestUser;
beforeEach(async () => {
  t = await createTestApp();
  admin = await registerUser(t, "admin", "chefe"); // primeira conta admin = criador do site
  ana = await registerUser(t, "member", "ana");
});
afterEach(async () => t.close());

const req = (u: TestUser, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
  t.app.inject({ method, url, headers: { cookie: u.cookie }, ...(payload ? { payload } : {}) });
/** Dá moedas pelo bônus de dias passados (25 por dia). */
const giveCoins = (u: TestUser, days: number) => {
  for (let d = 1; d <= days; d++) t.ctx.store.claimDaily(u.id, `2000-01-${String(d).padStart(2, "0")}`);
};

describe("moedas", () => {
  it("bônus do dia só na primeira conexão do dia, avisando quanto veio", async () => {
    const port = await listen(t);
    const first = await TestSocket.connect(port, ana.cookie);
    expect((await first.waitFor("hello")).wallet).toEqual({ coins: 0, items: [] });
    expect(await first.waitFor("wallet")).toMatchObject({ wallet: { coins: COINS.daily }, daily: COINS.daily });

    const second = await TestSocket.connect(port, ana.cookie);
    expect((await second.waitFor("hello")).wallet.coins).toBe(COINS.daily);
    await expect(second.waitFor("wallet", () => true, 300)).rejects.toThrow(/timeout/);
    first.close();
    second.close();
  });

  it("call com mais alguém paga por minuto até o teto do dia; sozinho não ganha", () => {
    const ch = voiceChannelId(t);
    t.ctx.voice.join(ana.id, "c1", ch);
    payVoiceMinute(t.ctx);
    expect(t.ctx.store.wallet(ana.id).coins).toBe(0);

    t.ctx.voice.join(admin.id, "c2", ch);
    for (let i = 0; i < COINS.voiceDailyMax + 10; i++) payVoiceMinute(t.ctx);
    expect(t.ctx.store.wallet(ana.id).coins).toBe(COINS.voiceDailyMax);
    // dia seguinte: o contador zera
    expect(t.ctx.store.addVoiceCoin(ana.id, "2999-01-01")).toBe(true);
    expect(coinDay(new Date("2026-11-25T02:00:00Z"))).toBe("2026-11-24"); // 23h em Brasília ainda é dia 24
  });
});

describe("loja", () => {
  const item = shopItem("neon")!;

  it("sem moedas não compra; comprando, desconta uma vez só", async () => {
    expect((await req(ana, "POST", `/api/shop/${item.id}/buy`)).json().error).toMatch(/insuficientes/);
    expect((await req(ana, "POST", "/api/shop/nao-existe/buy")).statusCode).toBe(404);
    giveCoins(ana, Math.ceil(item.price / COINS.daily));
    const before = t.ctx.store.wallet(ana.id).coins;
    const res = await req(ana, "POST", `/api/shop/${item.id}/buy`);
    expect(res.json().wallet).toEqual({ coins: before - item.price, items: [item.id] });
    expect((await req(ana, "POST", `/api/shop/${item.id}/buy`)).json().error).toMatch(/já tem/);
    expect(t.ctx.store.wallet(ana.id).coins).toBe(before - item.price);
  });

  it("só usa no perfil o que comprou, e no tipo certo", async () => {
    const equip = (look: object) => req(ana, "PATCH", "/api/me", { look: { ...DEFAULT_LOOK, ...look } });
    expect((await equip({ deco: item.id })).json().error).toMatch(/Loja/);
    expect((await equip({ nickFx: item.id })).statusCode).toBe(400); // decoração não vai no nick
    giveCoins(ana, Math.ceil(item.price / COINS.daily));
    await req(ana, "POST", `/api/shop/${item.id}/buy`);
    expect((await equip({ deco: item.id })).json().me.look.deco).toBe(item.id);
  });
});

describe("feedback implementado", () => {
  it("o criador marca, quem mandou recebe o aviso na hora e no próximo hello, e dispensa", async () => {
    const port = await listen(t);
    const anaSocket = await TestSocket.connect(port, ana.cookie);
    await anaSocket.waitFor("hello");
    await req(ana, "POST", "/api/client-errors", { kind: "feedback", message: "Sugestão: gif na foto de perfil" });
    const [fb] = (await req(admin, "GET", "/api/admin/feedback")).json().feedback;

    const outro = await registerUser(t, "admin", "outro-admin");
    expect((await req(outro, "POST", `/api/admin/feedback/${fb.id}/done`)).statusCode).toBe(403);
    const done = await req(admin, "POST", `/api/admin/feedback/${fb.id}/done`);
    expect(done.json().entry.doneAt).toBeTypeOf("number");
    expect((await req(admin, "POST", `/api/admin/feedback/${fb.id}/done`)).statusCode).toBe(404); // não avisa duas vezes

    const { notice } = await anaSocket.waitFor("user.notice");
    expect(notice.text).toContain("gif na foto de perfil");
    const again = await TestSocket.connect(port, ana.cookie);
    expect((await again.waitFor("hello")).notices).toEqual([notice]);

    expect((await req(admin, "DELETE", `/api/me/notices/${notice.id}`)).statusCode).toBe(404); // aviso de outra pessoa
    expect((await req(ana, "DELETE", `/api/me/notices/${notice.id}`)).statusCode).toBe(204);
    expect(t.ctx.store.listNotices(ana.id)).toEqual([]);
    anaSocket.close();
    again.close();
  });
});
