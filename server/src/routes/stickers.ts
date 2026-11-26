import type { FastifyInstance } from "fastify";
import { LIMITS } from "@resenha/shared";
import { rateLimited, requireUser, type AppContext } from "../app.ts";
import { badRequest, currentUser, notFound } from "../http.ts";
import { receiveAvatar } from "./avatars.ts";

const UUID = /^[0-9a-f-]{36}$/;
const full = () => badRequest(`Você já tem ${LIMITS.stickersMax} figurinhas. Tire alguma das suas antes.`);

/**
 * Figurinhas pessoais, como no WhatsApp: cada um cria as suas (a imagem vai para a pasta das fotos
 * e sai por /api/avatars/:id) e favorita as dos outros para usar também.
 */
export function registerStickerRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, hub } = ctx;
  // os outros aparelhos da pessoa ficam com a mesma lista
  const sync = (userId: string) => hub.sendToUser(userId, { type: "stickers", ids: store.myStickerIds(userId) });

  app.post("/api/stickers", { preHandler: requireUser, config: rateLimited(ctx, 10, "10 minutes") }, async (req, reply) => {
    const user = currentUser(req);
    if (store.myStickerIds(user.id).length >= LIMITS.stickersMax) throw full();
    const { id, mime } = await receiveAvatar(req, ctx);
    store.insertSticker(id, user.id, mime);
    sync(user.id);
    return reply.status(201).send({ id });
  });

  // favoritar a figurinha de outra pessoa
  app.put<{ Params: { id: string } }>("/api/stickers/:id", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params;
    if (!UUID.test(id) || !store.stickerExists(id)) throw notFound("Figurinha não encontrada");
    const user = currentUser(req);
    const mine = store.myStickerIds(user.id);
    if (!mine.includes(id)) {
      if (mine.length >= LIMITS.stickersMax) throw full();
      store.addSticker(user.id, id);
      sync(user.id);
    }
    return reply.status(204).send();
  });

  // tirar das suas: some do seu seletor, mas continua nas mensagens já enviadas
  app.delete<{ Params: { id: string } }>("/api/stickers/:id", { preHandler: requireUser }, async (req, reply) => {
    if (!UUID.test(req.params.id)) throw notFound();
    const user = currentUser(req);
    store.removeSticker(user.id, req.params.id);
    sync(user.id);
    return reply.status(204).send();
  });
}
