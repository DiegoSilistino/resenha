import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  APP_NAME,
  AVATAR_COLORS,
  forgotPasswordBody,
  loginBody,
  loginTwoFactorBody,
  registerBody,
  resetPasswordBody,
  WS_CLOSE_SESSION_REVOKED,
  type Invite,
  type InviteInfo,
} from "@resenha/shared";
import { rateLimited, requireUser, type AppContext } from "../app.ts";
import { transaction } from "../db.ts";
import { badRequest, currentUser, HttpError, notFound, parse, unauthorized } from "../http.ts";
import { dummyPasswordHash, hashPassword, verifyPassword } from "../auth/password.ts";
import { createSession, SESSION_COOKIE, SESSION_TTL_MS } from "../auth/sessions.ts";
import { toPublicUser } from "../store.ts";
import { publishUser } from "../realtime/socket.ts";
import { joinViaInvite } from "./rodas.ts";
import { checkCode, checkSecondFactor, issueCode } from "../auth/codes.ts";
import { emailTaken, sendEmailCode } from "./account.ts";

/** Senha certa de quem tem verificação em duas etapas: falta o código do app (5 min, 5 tentativas). */
interface Ticket {
  userId: string;
  expiresAt: number;
  attempts: number;
}
const TICKET_MS = 5 * 60_000;

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
  // shortcut: na memória, então reiniciar o servidor no meio do login pede a senha de novo; ir para o banco se houver mais de um processo
  const tickets = new Map<string, Ticket>();
  const issueTicket = (userId: string) => {
    const now = Date.now();
    for (const [key, t] of tickets) if (t.expiresAt < now) tickets.delete(key);
    const ticket = randomBytes(24).toString("base64url");
    tickets.set(ticket, { userId, expiresAt: now + TICKET_MS, attempts: 0 });
    return ticket;
  };

  app.get("/api/auth/me", { preHandler: requireUser }, async (req) => ({
    me: toPublicUser(currentUser(req)),
  }));

  /** Para o app saber se há sessão ao abrir: sempre 200 (sem erro no console de quem não entrou). */
  app.get("/api/auth/session", async (req) => ({
    me: req.auth ? toPublicUser(req.auth.user) : null,
  }));

  app.post("/api/auth/login", { config: rateLimited(ctx, 10, "15 minutes") }, async (req, reply) => {
    const body = parse(loginBody, req.body);
    const user = store.userByUsername(body.username);
    // Sempre roda o scrypt, exista ou não o usuário: o tempo de resposta não revela nada.
    const ok = await verifyPassword(body.password, user?.passwordHash ?? (await dummyPasswordHash()));
    if (!user || !ok || user.disabled) throw unauthorized("Usuário ou senha incorretos");
    // com verificação em duas etapas, o login só termina em /api/auth/login/2fa
    if (store.accountSecrets(user.id).totpSecret) return { twoFactor: true, ticket: issueTicket(user.id) };

    const { token } = createSession(store, user.id, req.headers["user-agent"] ?? null);
    setSessionCookie(ctx, reply, token);
    return { me: toPublicUser(user) };
  });

  app.post("/api/auth/login/2fa", { config: rateLimited(ctx, 10, "15 minutes") }, async (req, reply) => {
    const body = parse(loginTwoFactorBody, req.body);
    const t = tickets.get(body.ticket);
    const user = t && t.expiresAt > Date.now() && t.attempts < 5 ? store.userById(t.userId) : null;
    if (!t || !user || user.disabled) {
      tickets.delete(body.ticket);
      throw unauthorized("O tempo para digitar o código acabou. Entre de novo.");
    }
    if (!checkSecondFactor(store, user.id, body.code)) {
      t.attempts++;
      throw badRequest("Código incorreto", { code: "Código incorreto" });
    }
    tickets.delete(body.ticket);
    const { token } = createSession(store, user.id, req.headers["user-agent"] ?? null);
    setSessionCookie(ctx, reply, token);
    return { me: toPublicUser(user) };
  });

  // Esqueci a senha: o código vai para o e-mail confirmado da conta.
  app.post("/api/auth/forgot", { config: rateLimited(ctx, 5, "15 minutes") }, async (req, reply) => {
    const { email } = parse(forgotPasswordBody, req.body);
    if (!ctx.mailer) throw new HttpError(503, "Este servidor não manda e-mail. Peça para um administrador trocar sua senha.");
    const user = store.userByEmail(email);
    // Mesma resposta (e no mesmo tempo: o envio não é esperado) exista ou não a conta: não dá para descobrir e-mails cadastrados.
    if (user && !user.disabled) {
      const code = issueCode(store, user.id, "reset", email);
      void ctx.mailer
        .send(
          email,
          `Código para trocar a senha do ${APP_NAME}`,
          `Alguém (talvez você) pediu para trocar a senha da conta @${user.username} no ${APP_NAME}.\n\n` +
            `Código: ${code}\n\nEle vale por 15 minutos. Se não foi você, é só ignorar: sua senha continua a mesma.`,
        )
        .catch((err: unknown) => req.log.error({ err }, "falha ao mandar o e-mail de troca de senha"));
    }
    return reply.status(204).send();
  });

  app.post("/api/auth/reset", { config: rateLimited(ctx, 10, "15 minutes") }, async (req, reply) => {
    const body = parse(resetPasswordBody, req.body);
    const user = store.userByEmail(body.email);
    if (!user || user.disabled) throw badRequest("Código expirado. Peça outro.", { code: "Código expirado. Peça outro." });
    if (checkCode(store, user.id, "reset", body.code) !== body.email) {
      throw badRequest("Código expirado. Peça outro.", { code: "Código expirado. Peça outro." });
    }
    store.setPasswordHash(user.id, await hashPassword(body.password));
    // senha nova derruba todas as sessões: se alguém tinha entrado na conta, sai
    const revoked = new Set(store.deleteUserSessions(user.id));
    hub.closeWhere((c) => revoked.has(c.tokenHash), WS_CLOSE_SESSION_REVOKED, "senha alterada");
    return reply.status(204).send();
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
      const roda = invite.rodaId ? store.rodaById(invite.rodaId) : null;
      const info: InviteInfo = {
        role: invite.role,
        roda: roda
          ? {
              id: roda.id,
              name: roda.name,
              hue: roda.hue,
              iconUrl: roda.iconUrl,
              memberCount: Object.keys(roda.members).length,
              approval: invite.approval,
            }
          : null,
      };
      return info;
    },
  );

  app.post("/api/auth/register", { config: rateLimited(ctx, 10, "15 minutes") }, async (req, reply) => {
    const body = parse(registerBody, req.body);
    // Cadastro aberto: o convite é opcional. Quem vem por um link inválido é avisado, em vez de entrar sem a roda.
    if (body.code !== undefined && !isInviteUsable(store.inviteByCode(body.code))) {
      throw badRequest("Convite inválido, expirado ou já usado");
    }
    if (store.userByUsername(body.username)) {
      throw new HttpError(409, "Esse nome de usuário já existe", { username: "Esse nome de usuário já existe" });
    }
    if (body.email && store.userByEmail(body.email)) throw emailTaken();
    const passwordHash = await hashPassword(body.password);

    // Consome o convite (se veio um) e cria a conta juntos: ou acontecem os dois, ou nenhum.
    const user = transaction(store.db, () => {
      const invite = body.code === undefined ? null : store.inviteByCode(body.code);
      if (body.code !== undefined && (!invite || !store.consumeInvite(body.code))) {
        throw badRequest("Convite inválido, expirado ou já usado");
      }
      try {
        return store.createUser({
          username: body.username,
          displayName: body.displayName,
          passwordHash,
          role: invite?.role ?? "member",
          avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!,
        });
      } catch (err) {
        if (err instanceof Error && /UNIQUE constraint failed: users.username/.test(err.message)) {
          throw new HttpError(409, "Esse nome de usuário já existe", { username: "Esse nome de usuário já existe" });
        }
        throw err;
      }
    });

    publishUser(ctx, toPublicUser(user));
    // com convite, a conta nasce já dentro da roda dele (ou com o pedido feito, se precisa de aprovação);
    // sem convite, a pessoa entra nas rodas abertas ou espera alguém chamar
    const invite = body.code === undefined ? null : store.inviteByCode(body.code);
    if (invite) joinViaInvite(ctx, user, invite);
    // e-mail opcional: chega um código; a conta já existe, confirmar é o passo seguinte (dá para pular)
    const emailPending = !!body.email && (await sendEmailCode(ctx, user, body.email, req.log));
    const { token } = createSession(store, user.id, req.headers["user-agent"] ?? null);
    setSessionCookie(ctx, reply, token);
    return reply.status(201).send({ me: toPublicUser(user), emailPending });
  });
}
