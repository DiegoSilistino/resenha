/**
 * A matemática da criptografia de ponta a ponta das chamadas, sem LiveKit (roda igual no Node, para testar).
 * Cada chamada tem um par de chaves ECDH P-256 novo por pessoa; com ele, cada dupla combina uma chave só
 * dela (HKDF), que serve para entregar a chave de mídia de um para o outro sem o servidor conseguir abrir.
 */
const te = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ZERO_SALT = new Uint8Array(32);

export interface Identity {
  keys: CryptoKeyPair;
  /** Chave pública (bruta, em base64): é o que vai para os outros. */
  pub: string;
}

/** Par de chaves da chamada; a privada nunca sai do navegador (não exportável). */
export async function newIdentity(): Promise<Identity> {
  const keys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  return { keys, pub: b64(await crypto.subtle.exportKey("raw", keys.publicKey)) };
}

/** A chave entre mim e outra pessoa: os dois chegam nela sozinhos, e ela fica presa às duas identidades. */
export async function pairKey(mine: Identity, theirPub: string, me: string, them: string): Promise<CryptoKey> {
  const pub = await crypto.subtle.importKey("raw", unb64(theirPub), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, mine.keys.privateKey, 256);
  const hkdf = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  const info = te.encode(`resenha-chamada-v1|${[me, them].sort().join("|")}`);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: ZERO_SALT, info }, hkdf, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export interface Sealed {
  iv: string;
  ct: string;
}

/** AES-GCM com contexto (aad): quem, para quem e qual chave. Trocar qualquer um faz o `open` falhar. */
export async function seal(key: CryptoKey, data: Uint8Array<ArrayBuffer>, aad: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode(aad) }, key, data);
  return { iv: b64(iv), ct: b64(ct) };
}

/** null se a chave ou o contexto não batem (pacote adulterado, de outra pessoa ou de outra chave). */
export async function open(key: CryptoKey, sealed: Sealed, aad: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(sealed.iv), additionalData: te.encode(aad) },
      key,
      unb64(sealed.ct),
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}

/** Chave das legendas de quem fala: sai da chave de mídia dela (quem pode ouvir, pode ler). */
export async function captionKey(mediaKey: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const hkdf = await crypto.subtle.importKey("raw", mediaKey, "HKDF", false, ["deriveKey"]);
  const info = te.encode("resenha-legendas-v1");
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: ZERO_SALT, info }, hkdf, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Código de segurança da chamada, como o "código de privacidade de voz" do Discord: 30 números tirados das
 * chaves públicas de todos. Se o servidor trocasse a chave de alguém no meio, o código mudaria só para
 * alguns. Muda quando entra ou sai gente.
 */
export async function privacyCode(entries: [identity: string, pub: string][]): Promise<string> {
  const text = entries
    .map(([id, pub]) => `${id}:${pub}`)
    .sort()
    .join("\n");
  const hash = new DataView(await crypto.subtle.digest("SHA-256", te.encode(text)));
  return Array.from({ length: 6 }, (_, i) => String(hash.getUint32(i * 4) % 100_000).padStart(5, "0")).join(" ");
}
