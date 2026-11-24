import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { FastifyInstance, FastifyReply } from "fastify";
import { bannerGifBody, LIMITS } from "@resenha/shared";
import { rateLimited, requireUser, type AppContext } from "../app.ts";
import { badRequest, currentUser, HttpError, notFound, parse } from "../http.ts";
import { toPublicUser } from "../store.ts";
import { bannerInfo, imageInfo } from "../uploads/image.ts";

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
    return sendImage(reply, req.params.id, avatar.mime);
  });

  // Capa do perfil: imagem ou GIF, guardada na mesma pasta das fotos.
  app.post(
    "/api/me/banner",
    { preHandler: requireUser, config: rateLimited(ctx, 10, "10 minutes") },
    async (req) => {
      const tooBig = () => new HttpError(413, `A capa pode ter no máximo ${LIMITS.bannerMaxBytes / 1024 / 1024} MB`);
      const file = await req.file({ limits: { fileSize: LIMITS.bannerMaxBytes, files: 1 } });
      if (!file) throw badRequest("Nenhuma imagem enviada");
      let data: Buffer;
      try {
        data = await file.toBuffer();
      } catch (err) {
        if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw tooBig();
        throw err;
      }
      if (file.file.truncated) throw tooBig();
      return saveBanner(currentUser(req).id, data);
    },
  );

  // Capa escolhida no seletor de GIFs: o servidor baixa do GIPHY e guarda como se fosse enviada.
  app.post(
    "/api/me/banner/gif",
    { preHandler: requireUser, config: rateLimited(ctx, 10, "10 minutes") },
    async (req) => {
      if (!ctx.gifs) throw notFound();
      const { url } = parse(bannerGifBody, req.body);
      return saveBanner(currentUser(req).id, await ctx.gifs.download(url, LIMITS.bannerMaxBytes));
    },
  );

  async function saveBanner(userId: string, data: Buffer) {
    const info = bannerInfo(data);
    if (!info) throw badRequest("Envie uma imagem PNG, JPEG, WebP ou GIF");
    const max = LIMITS.bannerMaxSide;
    if (info.width < 1 || info.height < 1 || info.width > max || info.height > max) {
      throw badRequest(`A capa pode ter no máximo ${max} pixels de lado`);
    }
    const id = randomUUID();
    await writeFile(avatars.pathFor(id), data, { flag: "wx" });
    const previous = store.setBanner(userId, { id, mime: info.mime });
    if (previous) await avatars.remove([previous]);
    // quem escolhe uma capa quer vê-la: liga "Imagem ou GIF" sem depender do "Salvar perfil"
    const { look } = store.userById(userId)!;
    if (look.banner !== "imagem") store.updateUserProfile(userId, { look: { ...look, banner: "imagem" } });
    const me = toPublicUser(store.userById(userId)!);
    hub.broadcast({ type: "user.upsert", user: me });
    return { me };
  }

  app.delete("/api/me/banner", { preHandler: requireUser }, async (req) => {
    const user = currentUser(req);
    const previous = store.setBanner(user.id, null);
    if (previous) await avatars.remove([previous]);
    const me = toPublicUser(store.userById(user.id)!);
    hub.broadcast({ type: "user.upsert", user: me });
    return { me };
  });

  app.get<{ Params: { id: string } }>("/api/banners/:id", { preHandler: requireUser }, async (req, reply) => {
    if (!UUID.test(req.params.id)) throw notFound();
    const banner = store.bannerById(req.params.id);
    if (!banner) throw notFound("Capa não encontrada");
    return sendImage(reply, req.params.id, banner.mime);
  });

  function sendImage(reply: FastifyReply, id: string, mime: string) {
    reply
      .header("Content-Type", mime)
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox")
      // cada imagem nova ganha outro id, então esta URL nunca muda de conteúdo
      .header("Cache-Control", "private, max-age=31536000, immutable");
    return reply.sendFile(id, avatars.dir, { contentType: false, cacheControl: false });
  }
}
