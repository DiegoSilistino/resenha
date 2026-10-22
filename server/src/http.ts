import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { ApiErrorBody } from "@resenha/shared";
import type { UserRecord } from "./store.ts";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, fields?: Record<string, string>) => new HttpError(400, msg, fields);
export const unauthorized = (msg = "Faça login para continuar") => new HttpError(401, msg);
export const forbidden = (msg = "Você não tem permissão para isso") => new HttpError(403, msg);
export const notFound = (msg = "Não encontrado") => new HttpError(404, msg);

/** Valida com zod e transforma problemas em erro 400 legível, por campo. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  const first = Object.values(fields)[0] ?? "Dados inválidos";
  throw badRequest(first, fields);
}

export function sendError(reply: FastifyReply, err: HttpError) {
  const body: ApiErrorBody = { error: err.message };
  if (err.fields) body.fields = err.fields;
  return reply.status(err.status).send(body);
}

/** Usuário autenticado (garantido pelo hook `requireUser`). */
export function currentUser(req: FastifyRequest): UserRecord {
  if (!req.auth) throw unauthorized();
  return req.auth.user;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: { user: UserRecord; tokenHash: string } | null;
  }
}
