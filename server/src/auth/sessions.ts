import { createHash, randomBytes } from "node:crypto";
import type { Store, UserRecord } from "../store.ts";

export const SESSION_COOKIE = "resenha_sid";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Só regrava a sessão no banco se o último uso tiver mais de 1 hora (evita escrita a cada request). */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/** O banco guarda só o SHA-256 do token: um vazamento do banco não entrega sessões válidas. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");

export function createSession(store: Store, userId: string, userAgent: string | null) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  store.insertSession({
    tokenHash,
    userId,
    expiresAt: Date.now() + SESSION_TTL_MS,
    userAgent: userAgent?.slice(0, 300) ?? null,
  });
  return { token, tokenHash };
}

export interface ResolvedSession {
  user: UserRecord;
  tokenHash: string;
}

/** Valida o token; renova a validade (sessão deslizante). Retorna null se inválido, expirado ou conta desativada. */
export function resolveSession(store: Store, token: string | undefined): ResolvedSession | null {
  if (!token || token.length > 100) return null;
  const tokenHash = hashToken(token);
  const session = store.sessionByHash(tokenHash);
  const now = Date.now();
  if (!session) return null;
  if (session.expiresAt < now) {
    store.deleteSession(tokenHash);
    return null;
  }
  const user = store.userById(session.userId);
  if (!user || user.disabled) return null;
  if (now - session.lastSeenAt > TOUCH_INTERVAL_MS) store.touchSession(tokenHash, now + SESSION_TTL_MS);
  return { user, tokenHash };
}
