import type { FastifyInstance } from "fastify";
import { changePasswordBody, updateMeBody, WS_CLOSE_SESSION_REVOKED } from "@resenha/shared";
import { rateLimited, requireUser, type AppContext } from "../app.ts";
import { badRequest, currentUser, parse } from "../http.ts";
import { hashPassword, verifyPassword } from "../auth/password.ts";
import { toPublicUser } from "../store.ts";
import { publishUser } from "../realtime/socket.ts";

export function registerMeRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, hub } = ctx;

  app.patch("/api/me", { preHandler: requireUser }, async (req) => {
    const body = parse(updateMeBody, req.body);
    const user = store.updateUserProfile(currentUser(req).id, body);
    const me = toPublicUser(user);
    if (body.status) hub.setHidden(user.id, body.status === "invisivel");
    publishUser(ctx, me);
    return { me };
  });

  app.post(
    "/api/me/password",
    { preHandler: requireUser, config: rateLimited(ctx, 10, "15 minutes") },
    async (req, reply) => {
      const body = parse(changePasswordBody, req.body);
      const user = currentUser(req);
      if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
        throw badRequest("Senha atual incorreta", { currentPassword: "Senha atual incorreta" });
      }
      store.setPasswordHash(user.id, await hashPassword(body.newPassword));
      // Trocar a senha derruba as outras sessões (ex.: um aparelho esquecido logado).
      const revoked = new Set(store.deleteUserSessions(user.id, req.auth!.tokenHash));
      hub.closeWhere((c) => revoked.has(c.tokenHash), WS_CLOSE_SESSION_REVOKED, "senha alterada");
      return reply.status(204).send();
    },
  );
}
