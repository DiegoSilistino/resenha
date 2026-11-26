import { randomInt } from "node:crypto";
import { badRequest } from "../http.ts";
import type { AuthCodePurpose, Store } from "../store.ts";
import { hashToken } from "./sessions.ts";
import { normalizeRecoveryCode, verifyTotp } from "./totp.ts";

const CODE_TTL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;
const expired = () => badRequest("Código expirado. Peça outro.", { code: "Código expirado. Peça outro." });

/** Código de 6 números que vai por e-mail; o banco guarda só o hash. */
export function issueCode(store: Store, userId: string, purpose: AuthCodePurpose, email: string): string {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  store.saveAuthCode(userId, purpose, email, hashToken(code), Date.now() + CODE_TTL_MS);
  return code;
}

/** Confere o código (15 min, até 5 tentativas). Certo: ele some e volta o e-mail a que se referia. */
export function checkCode(store: Store, userId: string, purpose: AuthCodePurpose, code: string): string {
  const saved = store.authCode(userId, purpose);
  if (!saved || saved.expiresAt < Date.now() || saved.attempts >= MAX_ATTEMPTS) throw expired();
  if (saved.codeHash !== hashToken(code)) {
    store.countAuthCodeAttempt(userId, purpose);
    throw badRequest("Código incorreto", { code: "Código incorreto" });
  }
  store.deleteAuthCode(userId, purpose);
  return saved.email;
}

/** Segunda etapa: código do app (cada um entra uma vez só) ou um código de reserva (some depois de usado). */
export function checkSecondFactor(store: Store, userId: string, code: string): boolean {
  const { totpSecret, totpLastStep } = store.accountSecrets(userId);
  if (!totpSecret) return false;
  const step = verifyTotp(totpSecret, code.trim());
  if (step !== null && step > (totpLastStep ?? -1)) {
    store.setTotpLastStep(userId, step);
    return true;
  }
  const recovery = normalizeRecoveryCode(code);
  return recovery.length === 8 && store.useRecoveryCode(userId, hashToken(recovery));
}
