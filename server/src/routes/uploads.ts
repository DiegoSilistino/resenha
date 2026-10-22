import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { LIMITS } from "@resenha/shared";
import { rateLimited, requireUser, type AppContext } from "../app.ts";
import { badRequest, currentUser, HttpError, notFound } from "../http.ts";
import { sanitizeFilename, sniffMime } from "../uploads/sniff.ts";

export function registerUploadRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, uploads } = ctx;

  app.post(
    "/api/uploads",
    { preHandler: requireUser, config: rateLimited(ctx, 30, "1 minute") },
    async (req, reply) => {
      const file = await req.file();
      if (!file) throw badRequest("Nenhum arquivo enviado");

      const id = randomUUID();
      let saved: { size: number; head: Buffer };
      try {
        saved = await uploads.save(id, file.file);
      } catch (err) {
        await uploads.remove([id]);
        if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE" || file.file.truncated) {
          throw new HttpError(413, `Arquivo maior que ${LIMITS.uploadMaxBytes / 1024 / 1024} MB`);
        }
        throw err;
      }
      if (file.file.truncated) {
        await uploads.remove([id]);
        throw new HttpError(413, `Arquivo maior que ${LIMITS.uploadMaxBytes / 1024 / 1024} MB`);
      }
      if (saved.size === 0) {
        await uploads.remove([id]);
        throw badRequest("Arquivo vazio");
      }

      const sniffed = sniffMime(saved.head);
      const attachment = store.insertAttachment({
        id,
        uploaderId: currentUser(req).id,
        filename: sanitizeFilename(file.filename),
        mime: sniffed.mime,
        size: saved.size,
        inline: sniffed.inline,
      });
      return reply.status(201).send({ attachment });
    },
  );

  app.get<{ Params: { id: string; name: string } }>(
    "/api/files/:id/:name",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw notFound();
      const a = store.attachmentById(req.params.id);
      if (!a) throw notFound("Arquivo não encontrado");

      const disposition = a.inline ? "inline" : "attachment";
      const asciiName = a.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
      reply
        .header("Content-Type", a.mime)
        .header(
          "Content-Disposition",
          `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
        )
        .header("X-Content-Type-Options", "nosniff")
        // Mesmo que algo escape, o arquivo não roda script nem carrega nada.
        .header("Content-Security-Policy", "default-src 'none'; img-src 'self'; media-src 'self'; sandbox")
        .header("Cache-Control", "private, max-age=31536000, immutable");
      return reply.sendFile(a.id, uploads.dir, { contentType: false, acceptRanges: true });
    },
  );
}
