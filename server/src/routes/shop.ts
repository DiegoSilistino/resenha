import type { FastifyInstance } from "fastify";
import { COINS, shopItem } from "@resenha/shared";
import { requireUser, type AppContext } from "../app.ts";
import { badRequest, currentUser, notFound } from "../http.ts";

/** Dia no fuso do Brasil ("2026-11-24"): o bônus diário e o teto de moedas de call viram à meia-noite daqui. */
export const coinDay = (now = new Date()) => now.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

/** Bônus do dia ao conectar: só a primeira conexão do dia ganha, e a pessoa fica sabendo. */
export function grantDaily(ctx: AppContext, userId: string): void {
  if (!ctx.store.claimDaily(userId, coinDay())) return;
  ctx.hub.sendToUser(userId, { type: "wallet", wallet: ctx.store.wallet(userId), daily: COINS.daily });
}

/** Roda a cada minuto: quem está em call com mais alguém ganha moeda (até o teto do dia). */
export function payVoiceMinute(ctx: AppContext): void {
  const day = coinDay();
  for (const members of Object.values(ctx.voice.snapshot())) {
    if (members.length < 2) continue;
    for (const { userId } of members) {
      if (ctx.store.addVoiceCoin(userId, day)) ctx.hub.sendToUser(userId, { type: "wallet", wallet: ctx.store.wallet(userId) });
    }
  }
}

export function registerShopRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, hub } = ctx;

  app.post<{ Params: { item: string } }>("/api/shop/:item/buy", { preHandler: requireUser }, async (req) => {
    const user = currentUser(req);
    const item = shopItem(req.params.item);
    if (!item) throw notFound("Item não encontrado");
    const result = store.buyItem(user.id, item.id, item.price);
    if (result === "owned") throw badRequest("Você já tem esse item");
    if (result === "poor") throw badRequest("Moedas insuficientes");
    const wallet = store.wallet(user.id);
    hub.sendToUser(user.id, { type: "wallet", wallet }); // outras abas abertas
    return { wallet };
  });

  app.delete<{ Params: { id: string } }>("/api/me/notices/:id", { preHandler: requireUser }, async (req, reply) => {
    if (!store.deleteNotice(currentUser(req).id, Number(req.params.id))) throw notFound("Aviso não encontrado");
    return reply.status(204).send();
  });
}
