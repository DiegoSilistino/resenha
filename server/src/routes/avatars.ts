import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { LIMITS } from "@resenha/shared";
import { rateLimited, requireUser, type AppContext } from "../app.ts";
import { badRequest, currentUser, HttpError, notFound } from "../http.ts";
import { toPublicUser } from "../store.ts";
import { imageInfo } from "../uploads/image.ts";

const UUID = /^[0-9a-f-]{36}$/;
const tooLarge = () => new HttpError(413, `A foto pode ter no máximo ${LIMITS.avatarMaxBytes / 1024 / 1024} MB`);

export function registerAvatarRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, hub, avatars } = ctx;

  app.post(
    "/api/me/avatar",
    { preHandler: requireUser, config: rateLimited(ctx, 10, "10 minutes") },
    async (req) => {
      const file = await req.file({ limits: { fileSize: LIMITS.avatarMaxBytes, files: 1 } });
      if (!file) throw badRequest("Nenhuma imagem enviada");
      let data: Buffer;
      try {
        data = await file.toBuffer();
      } catch (err) {
        if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw tooLarge();
        throw err;
      }
      if (file.file.truncated) throw tooLarge();

      // O tipo vem dos bytes, nunca do nome nem do que o navegador diz.
      const info = imageInfo(data);
      if (!info) throw badRequest("Envie uma imagem PNG, JPEG ou WebP");
      if (info.animated) throw badRequest("Foto animada não é aceita; use uma imagem parada");
      const { avatarMinSide: min, avatarMaxSide: max } = LIMITS;
      if (info.width < min || info.height < min || info.width > max || info.height > max) {
        throw badRequest(`A foto precisa ter entre ${min} e ${max} pixels de lado`);
      }

      const user = currentUser(req);
      const id = randomUUID();
      await writeFile(avatars.pathFor(id), data, { flag: "wx" });
      const previous = store.setAvatar(user.id, { id, mime: info.mime });
      if (previous) await avatars.remove([previous]);
      const me = toPublicUser(store.userById(user.id)!);
      hub.broadcast({ type: "user.upsert", user: me });
      return { me };
    },
  );

  app.delete("/api/me/avatar", { preHandler: requireUser }, async (req) => {
    const user = currentUser(req);
    const previous = store.setAvatar(user.id, null);
    if (previous) await avatars.remove([previous]);
    const me = toPublicUser(store.userById(user.id)!);
    hub.broadcast({ type: "user.upsert", user: me });
    return { me };
  });

  app.get<{ Params: { id: string } }>("/api/avatars/:id", { preHandler: requireUser }, async (req, reply) => {
    if (!UUID.test(req.params.id)) throw notFound();
    const avatar = store.avatarById(req.params.id);
    if (!avatar) throw notFound("Foto não encontrada");
    reply
      .header("Content-Type", avatar.mime)
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox")
      // cada foto nova ganha outro id, então esta URL nunca muda de conteúdo
      .header("Cache-Control", "private, max-age=31536000, immutable");
    return reply.sendFile(req.params.id, avatars.dir, { contentType: false, cacheControl: false });
  });
}
