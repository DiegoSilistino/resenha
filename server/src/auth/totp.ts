import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Verificação em duas etapas por app autenticador (TOTP, RFC 6238): o código de 6 números
 * do Google Authenticator, Authy, 1Password… Sem dependência: é só HMAC-SHA1 sobre o relógio.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_MS = 30_000;

export function base32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
      value &= (1 << bits) - 1;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text.replace(/=+$/, "").toUpperCase()) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("segredo base32 inválido");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(out);
}

/** Segredo novo (160 bits, o tamanho que os apps esperam), em base32 como vai no QR. */
export const newTotpSecret = (): string => base32(randomBytes(20));

export const totpStep = (now = Date.now()): number => Math.floor(now / STEP_MS);

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", fromBase32(secret)).update(counter).digest();
  const offset = h[h.length - 1]! & 0x0f;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** O passo do código, se ele vale agora (aceita o anterior e o seguinte: relógio do celular um pouco fora); senão null. */
export function verifyTotp(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = totpStep(now);
  for (const s of [step, step - 1, step + 1]) {
    if (timingSafeEqual(Buffer.from(totpCode(secret, s)), Buffer.from(code))) return s;
  }
  return null;
}

/** O link que vira QR: o app autenticador lê e já cadastra a conta. */
export function otpauthUrl(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** 10 códigos de reserva (xxxx-xxxx) para entrar sem o celular; cada um vale uma vez. */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const hex = randomBytes(4).toString("hex");
    return `${hex.slice(0, 4)}-${hex.slice(4)}`;
  });
}

/** Para comparar o que a pessoa digitou: sem hífen, espaço ou maiúscula. */
export const normalizeRecoveryCode = (code: string): string => code.toLowerCase().replace(/[^0-9a-f]/g, "");
