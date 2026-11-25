import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { avatarGifBody, avatarPos, bannerGifBody, LIMITS } from "@resenha/shared";
import { rateLimited, requireUser, type AppContext } from "../app.ts";
import { badRequest, currentUser, HttpError, notFound, parse } from "../http.ts";
import { toPublicUser } from "../store.ts";
import { publishUser } from "../realtime/socket.ts";
import { bannerInfo, imageInfo } from "../uploads/image.ts";

const UUID = /^[0-9a-f-]{36}$/;
const tooLarge = () => new HttpError(413, `A foto pode ter no máximo ${LIMITS.avatarMaxBytes / 1024 / 1024} MB`);

/** Recebe a foto enviada (perfil ou roda), no tamanho certo, gravada na pasta das fotos. `animated`: aceita GIF (perfil). */
export async function receiveAvatar(
  req: FastifyRequest,
  ctx: AppContext,
  { animated = false } = {},
): Promise<{ id: string; mime: string }> {
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
  return writeAvatar(ctx, data, animated);
}

async function writeAvatar(ctx: AppContext, data: Buffer, animated: boolean): Promise<{ id: string; mime: string }> {
  // O tipo vem dos bytes, nunca do nome nem do que o navegador diz.
  const info = animated ? bannerInfo(data) : imageInfo(data);
  if (!info) throw badRequest(animated ? "Envie uma imagem PNG, JPEG, WebP ou GIF" : "Envie uma imagem PNG, JPEG ou WebP");
  if (!animated && "animated" in info && info.animated) throw badRequest("Foto animada não é aceita; use uma imagem parada");
  const { avatarMinSide: min, avatarMaxSide: max } = LIMITS;
  if (info.width < min || info.height < min || info.width > max || info.height > max) {
    throw badRequest(`A foto precisa ter entre ${min} e ${max} pixels de lado`);
  }
  const id = randomUUID();
  await writeFile(ctx.avatars.pathFor(id), data, { flag: "wx" });
  return { id, mime: info.mime };
}

/** Lê a capa enviada pelo formulário (perfil ou roda), recusando o que passar do limite. */
export async function readBannerUpload(req: FastifyRequest): Promise<Buffer> {
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
  return data;
}

/** Confere que a capa é imagem ou GIF de tamanho aceito e grava na pasta das fotos. */
export async function writeBanner(ctx: AppContext, data: Buffer): Promise<{ id: string; mime: string }> {
  // O tipo vem dos bytes, nunca do nome nem do que o navegador diz.
  const info = bannerInfo(data);
  if (!info) throw badRequest("Envie uma imagem PNG, JPEG, WebP ou GIF");
  const max = LIMITS.bannerMaxSide;
  if (info.width < 1 || info.height < 1 || info.width > max || info.height > max) {
    throw badRequest(`A capa pode ter no máximo ${max} pixels de lado`);
  }
  const id = randomUUID();
  await writeFile(ctx.avatars.pathFor(id), data, { flag: "wx" });
  return { id, mime: info.mime };
}

export function registerAvatarRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, hub, avatars } = ctx;

  // Foto do perfil: parada (já recortada no navegador) ou GIF, que vai inteiro e é enquadrado pela posição.
  app.post(
    "/api/me/avatar",
    { preHandler: requireUser, config: rateLimited(ctx, 10, "10 minutes") },
    async (req) => {
      const pos = parse(avatarPos, req.query);
      return saveAvatar(currentUser(req).id, await receiveAvatar(req, ctx, { animated: true }), pos);
    },
  );

  app.post(
    "/api/me/avatar/gif",
    { preHandler: requireUser, config: rateLimited(ctx, 10, "10 minutes") },
    async (req) => {
      if (!ctx.gifs) throw notFound();
      const { url, ...pos } = parse(avatarGifBody, req.body);
      return saveAvatar(currentUser(req).id, await writeAvatar(ctx, await ctx.gifs.download(url, LIMITS.avatarMaxBytes), true), pos);
    },
  );

  async function saveAvatar(userId: string, image: { id: string; mime: string }, pos: { x: number; y: number; zoom: number }) {
    const previous = store.setAvatar(userId, image);
    if (previous) await avatars.remove([previous]);
    // a posição vale para a foto nova (a parada chega com 50/50/1, que é "como veio")
    const { look } = store.userById(userId)!;
    store.updateUserProfile(userId, { look: { ...look, avatarX: pos.x, avatarY: pos.y, avatarZoom: pos.zoom } });
    const me = toPublicUser(store.userById(userId)!);
    publishUser(ctx, me);
    return { me };
  }

  app.delete("/api/me/avatar", { preHandler: requireUser }, async (req) => {
    const user = currentUser(req);
    const previous = store.setAvatar(user.id, null);
    if (previous) await avatars.remove([previous]);
    const me = toPublicUser(store.userById(user.id)!);
    publishUser(ctx, me);
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
    async (req) => saveBanner(currentUser(req).id, await readBannerUpload(req)),
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
    const previous = store.setBanner(userId, await writeBanner(ctx, data));
    if (previous) await avatars.remove([previous]);
    // quem escolhe uma capa quer vê-la: liga "Imagem ou GIF" sem depender do "Salvar perfil"
    const { look } = store.userById(userId)!;
    if (look.banner !== "imagem") store.updateUserProfile(userId, { look: { ...look, banner: "imagem" } });
    const me = toPublicUser(store.userById(userId)!);
    publishUser(ctx, me);
    return { me };
  }

  app.delete("/api/me/banner", { preHandler: requireUser }, async (req) => {
    const user = currentUser(req);
    const previous = store.setBanner(user.id, null);
    if (previous) await avatars.remove([previous]);
    const me = toPublicUser(store.userById(user.id)!);
    publishUser(ctx, me);
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
