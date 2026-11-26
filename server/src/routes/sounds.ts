import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { LIMITS, soundMeta } from "@resenha/shared";
import { rateLimited, requireUser, type AppContext } from "../app.ts";
import { badRequest, currentUser, forbidden, HttpError, notFound, parse } from "../http.ts";
import { audioMime } from "../uploads/audio.ts";

const UUID = /^[0-9a-f-]{36}$/;
const tooLarge = () => new HttpError(413, `O som pode ter no máximo ${LIMITS.soundMaxBytes / 1024 / 1024} MB`);

export function registerSoundRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, hub, sounds } = ctx;

  // Nome e emoji vão na URL: assim não dependem da ordem dos campos no formulário.
  // personal=1: vai para a mesa pessoal de quem enviou (só ela vê e toca; a chamada toda ouve).
  app.post<{ Querystring: { name?: string; emoji?: string; personal?: string } }>(
    "/api/sounds",
    { preHandler: requireUser, config: rateLimited(ctx, 15, "10 minutes") },
    async (req, reply) => {
      const meta = parse(soundMeta, req.query);
      const user = currentUser(req);
      const personal = req.query.personal === "1";
      if (personal && store.countSounds(user.id) >= LIMITS.personalSoundsMax) {
        throw badRequest(`Sua mesa já tem ${LIMITS.personalSoundsMax} sons. Apague algum antes de enviar outro.`);
      }
      if (!personal && store.countSounds() >= LIMITS.soundsMax) {
        throw badRequest(`O soundboard já tem ${LIMITS.soundsMax} sons. Apague algum antes de enviar outro.`);
      }
      const file = await req.file({ limits: { fileSize: LIMITS.soundMaxBytes, files: 1 } });
      if (!file) throw badRequest("Nenhum arquivo enviado");
      let data: Buffer;
      try {
        data = await file.toBuffer();
      } catch (err) {
        if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw tooLarge();
        throw err;
      }
      if (file.file.truncated) throw tooLarge();
      const mime = audioMime(data);
      if (!mime) throw badRequest("Envie um áudio MP3, OGG, WAV, M4A ou WebM");

      const id = randomUUID();
      await writeFile(sounds.pathFor(id), data, { flag: "wx" });
      const sound = store.insertSound({ id, name: meta.name, emoji: meta.emoji, uploaderId: user.id, mime, size: data.length, personal });
      if (personal) hub.sendToUser(user.id, { type: "sound.upsert", sound });
      else hub.broadcast({ type: "sound.upsert", sound });
      return reply.status(201).send({ sound });
    },
  );

  app.delete<{ Params: { id: string } }>("/api/sounds/:id", { preHandler: requireUser }, async (req, reply) => {
    if (!UUID.test(req.params.id)) throw notFound();
    const sound = store.soundById(req.params.id);
    if (!sound) throw notFound("Som não encontrado");
    const user = currentUser(req);
    if (sound.uploaderId !== user.id && user.role !== "admin") throw forbidden("Só quem enviou (ou um admin) pode apagar");
    store.deleteSound(sound.id);
    await sounds.remove([sound.id]);
    if (sound.personal) hub.sendToUser(sound.uploaderId, { type: "sound.remove", soundId: sound.id });
    else hub.broadcast({ type: "sound.remove", soundId: sound.id });
    return reply.status(204).send();
  });

  app.get<{ Params: { id: string } }>("/api/sounds/:id", { preHandler: requireUser }, async (req, reply) => {
    if (!UUID.test(req.params.id)) throw notFound();
    const sound = store.soundById(req.params.id);
    if (!sound) throw notFound("Som não encontrado");
    reply
      .header("Content-Type", sound.mime)
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox")
      .header("Cache-Control", "private, max-age=31536000, immutable");
    return reply.sendFile(sound.id, sounds.dir, { contentType: false, cacheControl: false });
  });
}
