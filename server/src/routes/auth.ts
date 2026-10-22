import type { FastifyInstance, FastifyReply } from "fastify";
import { AVATAR_COLORS, loginBody, registerBody, type Invite } from "@resenha/shared";
import { rateLimited, requireUser, type AppContext } from "../app.ts";
import { transaction } from "../db.ts";
import { badRequest, currentUser, HttpError, notFound, parse, unauthorized } from "../http.ts";
import { dummyPasswordHash, hashPassword, verifyPassword } from "../auth/password.ts";
import { createSession, SESSION_COOKIE, SESSION_TTL_MS } from "../auth/sessions.ts";
import { toPublicUser } from "../store.ts";

export function isInviteUsable(invite: Invite | null, now = Date.now()): invite is Invite {
  return (
    !!invite &&
    !invite.revoked &&
    invite.uses < invite.maxUses &&
    (invite.expiresAt === null || invite.expiresAt > now)
  );
}

export function setSessionCookie(ctx: AppContext, reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: ctx.config.cookieSecure,
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, hub } = ctx;

  app.get("/api/auth/me", { preHandler: requireUser }, async (req) => ({
    me: toPublicUser(currentUser(req)),
  }));

  app.post("/api/auth/login", { config: rateLimited(ctx, 10, "15 minutes") }, async (req, reply) => {
    const body = parse(loginBody, req.body);
    const user = store.userByUsername(body.username);
    // Sempre roda o scrypt, exista ou não o usuário: o tempo de resposta não revela nada.
    const ok = await verifyPassword(body.password, user?.passwordHash ?? (await dummyPasswordHash()));
    if (!user || !ok || user.disabled) throw unauthorized("Usuário ou senha incorretos");

    const { token } = createSession(store, user.id, req.headers["user-agent"] ?? null);
    setSessionCookie(ctx, reply, token);
    return { me: toPublicUser(user) };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    if (req.auth) {
      const { tokenHash } = req.auth;
      store.deleteSession(tokenHash);
      hub.closeWhere((c) => c.tokenHash === tokenHash, 1000, "logout");
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.status(204).send();
  });

  app.get<{ Params: { code: string } }>(
    "/api/invites/:code",
    { config: rateLimited(ctx, 30, "15 minutes") },
    async (req) => {
      const invite = store.inviteByCode(req.params.code);
      if (!isInviteUsable(invite)) throw notFound("Convite inválido, expirado ou já usado");
      return { role: invite.role };
    },
  );

  app.post("/api/auth/register", { config: rateLimited(ctx, 10, "15 minutes") }, async (req, reply) => {
    const body = parse(registerBody, req.body);
    if (!isInviteUsable(store.inviteByCode(body.code))) {
      throw badRequest("Convite inválido, expirado ou já usado");
    }
    if (store.userByUsername(body.username)) {
      throw new HttpError(409, "Esse nome de usuário já existe", { username: "Esse nome de usuário já existe" });
    }
    const passwordHash = await hashPassword(body.password);

    // Consome o convite e cria a conta juntos: ou acontecem os dois, ou nenhum.
    const user = transaction(store.db, () => {
      const invite = store.inviteByCode(body.code)!;
      if (!store.consumeInvite(body.code)) throw badRequest("Convite inválido, expirado ou já usado");
      try {
        return store.createUser({
          username: body.username,
          displayName: body.displayName,
          passwordHash,
          role: invite.role,
          avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!,
        });
      } catch (err) {
        if (err instanceof Error && /UNIQUE constraint failed: users.username/.test(err.message)) {
          throw new HttpError(409, "Esse nome de usuário já existe", { username: "Esse nome de usuário já existe" });
        }
        throw err;
      }
    });

    hub.broadcast({ type: "user.upsert", user: toPublicUser(user) });
    const { token } = createSession(store, user.id, req.headers["user-agent"] ?? null);
    setSessionCookie(ctx, reply, token);
    return reply.status(201).send({ me: toPublicUser(user) });
  });
}
