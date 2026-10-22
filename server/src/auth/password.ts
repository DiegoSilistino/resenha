import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * scrypt nativo do Node: sem dependência nativa extra.
 * N=2^16, r=8, p=1 usa ~64 MiB por hash (~100–200 ms), bom para um servidor pequeno.
 */
const PARAMS = { N: 2 ** 16, r: 8, p: 1 } as const;
const KEY_LEN = 64;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const maxmem = (N: number, r: number) => 128 * N * r * 2;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p } = PARAMS;
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LEN, { N, r, p, maxmem: maxmem(N, r) });
  return ["scrypt", N, r, p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts as [string, string, string, string, string, string];
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (![N, R, P].every(Number.isSafeInteger)) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N,
    r: R,
    p: P,
    maxmem: maxmem(N, R),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Hash fixo usado quando o usuário não existe, para o login levar o mesmo tempo
 * e não revelar quais nomes de usuário existem.
 */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword("senha-inexistente-para-tempo-constante");
  return dummyHash;
}
