import { describe, expect, it } from "vitest";
import { captionKey, newIdentity, open, pairKey, privacyCode, seal } from "../src/voice/e2eeCrypto.ts";

const bytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

describe("criptografia de ponta a ponta das chamadas", () => {
  it("cada dupla chega na mesma chave; um terceiro não abre", async () => {
    const [ana, bia, caio] = await Promise.all([newIdentity(), newIdentity(), newIdentity()]);
    const anaBia = await pairKey(ana, bia.pub, "ana", "bia");
    const biaAna = await pairKey(bia, ana.pub, "bia", "ana");
    const caioAna = await pairKey(caio, ana.pub, "caio", "ana");

    const mediaKey = bytes(32);
    const sealed = await seal(anaBia, mediaKey, "ana>bia|3");
    expect(await open(biaAna, sealed, "ana>bia|3")).toEqual(mediaKey);
    expect(await open(caioAna, sealed, "ana>bia|3")).toBeNull();
    // o contexto amarra remetente, destinatário e índice: reaproveitar o pacote em outro lugar falha
    expect(await open(biaAna, sealed, "ana>bia|4")).toBeNull();
    expect(await open(biaAna, sealed, "caio>bia|3")).toBeNull();
  });

  it("legendas abrem com a chave tirada da chave de mídia de quem fala", async () => {
    const mediaKey = bytes(32);
    const [mine, theirs] = await Promise.all([captionKey(mediaKey), captionKey(mediaKey)]);
    const text = new TextEncoder().encode('{"text":"oi"}');
    expect(await open(theirs, await seal(mine, text, "legenda|ana|0"), "legenda|ana|0")).toEqual(text);
    expect(await open(await captionKey(bytes(32)), await seal(mine, text, "legenda|ana|0"), "legenda|ana|0")).toBeNull();
  });

  it("código de segurança: igual para todos, em qualquer ordem; muda se alguém troca de chave", async () => {
    const entries: [string, string][] = [
      ["ana", (await newIdentity()).pub],
      ["bia", (await newIdentity()).pub],
    ];
    const code = await privacyCode(entries);
    expect(code).toMatch(/^\d{5}( \d{5}){5}$/);
    expect(await privacyCode([...entries].reverse())).toBe(code);
    expect(await privacyCode([entries[0]!, ["bia", (await newIdentity()).pub]])).not.toBe(code);
  });
});
