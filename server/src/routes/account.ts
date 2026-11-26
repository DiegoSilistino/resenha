import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import {
  APP_NAME,
  confirmCodeBody,
  disableTwoFactorBody,
  passwordOnlyBody,
  setEmailBody,
  type AccountSecurity,
} from "@resenha/shared";
import { rateLimited, requireUser, type AppContext } from "../app.ts";
import { badRequest, currentUser, HttpError, parse } from "../http.ts";
import { checkCode, checkSecondFactor, issueCode } from "../auth/codes.ts";
import { verifyPassword } from "../auth/password.ts";
import { hashToken } from "../auth/sessions.ts";
import { newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, otpauthUrl, verifyTotp } from "../auth/totp.ts";
import type { UserRecord } from "../store.ts";

const noMail = () => new HttpError(503, "Este servidor ainda não manda e-mail. Fale com o administrador.");
export const emailTaken = () => new HttpError(409, "Esse e-mail já está em outra conta", { email: "Esse e-mail já está em outra conta" });

/** Manda o código que confirma o e-mail. false se o envio falhou (o motivo vai para o log). */
export async function sendEmailCode(ctx: AppContext, user: UserRecord, email: string, log: FastifyBaseLogger): Promise<boolean> {
  if (!ctx.mailer) return false;
  const code = issueCode(ctx.store, user.id, "email", email);
  try {
    await ctx.mailer.send(
      email,
      `Seu código do ${APP_NAME}: ${code}`,
      `Oi, ${user.displayName}!\n\nUse este código para confirmar seu e-mail no ${APP_NAME}: ${code}\n\n` +
        `Ele vale por 15 minutos. Se não foi você, é só ignorar este e-mail.`,
    );
    return true;
  } catch (err) {
    log.error({ err }, "falha ao mandar o e-mail de confirmação");
    return false;
  }
}

/** E-mail (para recuperar a senha) e verificação em duas etapas, em Configurações → Conta. */
export function registerAccountRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store } = ctx;

  const security = (userId: string): AccountSecurity => {
    const s = store.accountSecrets(userId);
    const pending = store.authCode(userId, "email");
    return {
      email: s.email,
      pendingEmail: pending && pending.expiresAt > Date.now() ? pending.email : null,
      twoFactor: !!s.totpSecret,
      mailEnabled: !!ctx.mailer,
    };
  };

  // Mudar e-mail ou a verificação pede a senha: quem pegou o celular desbloqueado não sequestra a conta.
  const requirePassword = async (user: UserRecord, password: string) => {
    if (!(await verifyPassword(password, user.passwordHash))) throw badRequest("Senha incorreta", { password: "Senha incorreta" });
  };

  app.get("/api/me/security", { preHandler: requireUser }, async (req) => security(currentUser(req).id));

  app.post("/api/me/email", { preHandler: requireUser, config: rateLimited(ctx, 5, "15 minutes") }, async (req) => {
    const body = parse(setEmailBody, req.body);
    const user = currentUser(req);
    await requirePassword(user, body.password);
    if (!ctx.mailer) throw noMail();
    const owner = store.userByEmail(body.email);
    if (owner && owner.id !== user.id) throw emailTaken();
    if (!(await sendEmailCode(ctx, user, body.email, req.log))) {
      throw new HttpError(502, "Não consegui mandar o e-mail agora. Tente de novo daqui a pouco.");
    }
    return security(user.id);
  });

  app.post("/api/me/email/confirm", { preHandler: requireUser, config: rateLimited(ctx, 10, "15 minutes") }, async (req) => {
    const { code } = parse(confirmCodeBody, req.body);
    const user = currentUser(req);
    const email = checkCode(store, user.id, "email", code);
    const owner = store.userByEmail(email);
    if (owner && owner.id !== user.id) throw emailTaken();
    store.setEmail(user.id, email);
    return security(user.id);
  });

  app.post("/api/me/email/remove", { preHandler: requireUser, config: rateLimited(ctx, 5, "15 minutes") }, async (req) => {
    const { password } = parse(passwordOnlyBody, req.body);
    const user = currentUser(req);
    await requirePassword(user, password);
    store.setEmail(user.id, null);
    store.deleteAuthCode(user.id, "email");
    return security(user.id);
  });

  // 1º passo: segredo novo (ainda não vale); o app mostra o QR. Só liga depois de um código certo.
  app.post("/api/me/2fa/setup", { preHandler: requireUser, config: rateLimited(ctx, 10, "15 minutes") }, async (req) => {
    const { password } = parse(passwordOnlyBody, req.body);
    const user = currentUser(req);
    await requirePassword(user, password);
    if (store.accountSecrets(user.id).totpSecret) throw badRequest("A verificação em duas etapas já está ligada");
    const secret = newTotpSecret();
    store.setTotpPending(user.id, secret);
    return { secret, url: otpauthUrl(secret, user.username, APP_NAME) };
  });

  app.post("/api/me/2fa/enable", { preHandler: requireUser, config: rateLimited(ctx, 10, "15 minutes") }, async (req) => {
    const { code } = parse(confirmCodeBody, req.body);
    const user = currentUser(req);
    const pending = store.accountSecrets(user.id).totpPending;
    if (!pending) throw badRequest("Comece de novo: o QR expirou.");
    const step = verifyTotp(pending, code);
    if (step === null) throw badRequest("Código incorreto. Confira se o relógio do celular está certo.", { code: "Código incorreto" });
    const recoveryCodes = newRecoveryCodes();
    store.enableTotp(user.id, pending, recoveryCodes.map((c) => hashToken(normalizeRecoveryCode(c))));
    store.setTotpLastStep(user.id, step);
    // os códigos de reserva só aparecem agora; o banco guarda só o hash
    return { recoveryCodes };
  });

  app.post("/api/me/2fa/disable", { preHandler: requireUser, config: rateLimited(ctx, 10, "15 minutes") }, async (req) => {
    const body = parse(disableTwoFactorBody, req.body);
    const user = currentUser(req);
    await requirePassword(user, body.password);
    if (!checkSecondFactor(store, user.id, body.code)) throw badRequest("Código incorreto", { code: "Código incorreto" });
    store.disableTotp(user.id);
    return security(user.id);
  });
}
