import { describe, expect, it } from "vitest";
import { gifFromMessage, inviteCodes, parseGifMessage, parseStickerMessage, plainText, stickerMessage } from "../src/chat/plain.ts";

describe("figurinha", () => {
  it("a mensagem do seletor volta como figurinha e aparece como 'Figurinha' nas prévias", () => {
    expect(parseStickerMessage(stickerMessage("rindo"))).toBe("rindo");
    expect(plainText(stickerMessage("brinde"))).toBe("Figurinha");
  });
  it("texto em volta ou formato diferente continua sendo texto", () => {
    expect(parseStickerMessage("olha [figurinha:rindo]")).toBeNull();
    expect(parseStickerMessage("[figurinha:Rindo!]")).toBeNull();
    expect(plainText("olha [figurinha:rindo]")).toBe("olha [figurinha:rindo]");
  });
});

describe("favoritar GIF pela conversa", () => {
  it("usa o id do GIPHY do link (o mesmo do seletor), com e sem o prefixo v1", () => {
    const fav = gifFromMessage("https://media2.giphy.com/media/v1.Y2lk/3o7TKSjRrfIPjeiVyM/giphy.mp4?cid=x#480x270");
    expect(fav).toMatchObject({ id: "3o7TKSjRrfIPjeiVyM", width: 480, height: 270, mp4Url: "https://media2.giphy.com/media/v1.Y2lk/3o7TKSjRrfIPjeiVyM/giphy.mp4?cid=x" });
    expect(fav?.imageUrl).toBe("https://media2.giphy.com/media/v1.Y2lk/3o7TKSjRrfIPjeiVyM/200.webp");
    expect(gifFromMessage("https://media.giphy.com/media/abc123/giphy.mp4")?.id).toBe("abc123");
  });
  it("texto comum não vira favorito", () => {
    expect(gifFromMessage("oi https://media.giphy.com/media/abc/giphy.mp4")).toBeNull();
  });
});

describe("links de convite de roda na mensagem", () => {
  const site = "https://resenha.example";
  it("acha os códigos deste servidor, sem repetir", () => {
    const text = `Bora entrar na roda? ${site}/convite/AbC_12-x e de novo ${site}/convite/AbC_12-x, e ${site}/convite/Zz9`;
    expect(inviteCodes(text, site)).toEqual(["AbC_12-x", "Zz9"]);
  });
  it("ignora outro site e endereço parecido", () => {
    expect(inviteCodes("https://outro.example/convite/abc", site)).toEqual([]);
    expect(inviteCodes("https://resenhaXexample/convite/abc", site)).toEqual([]);
  });
});

describe("texto puro", () => {
  it("tira marcação, junta linhas e esconde spoiler", () => {
    expect(plainText("**bora** ~~jogar~~ `cs`\nhoje ||o boss morre no fim||")).toBe("bora jogar cs hoje ▒▒▒▒");
  });

  it("GIF vira a palavra GIF", () => {
    expect(plainText("https://media2.giphy.com/media/abc/giphy.mp4?cid=1#480x270")).toBe("GIF");
  });
});

describe("mensagem de GIF", () => {
  it("reconhece a URL do GIPHY com dimensões", () => {
    expect(parseGifMessage(" https://media2.giphy.com/media/abc/giphy.mp4?cid=1&ct=g#480x270 ")).toEqual({
      src: "https://media2.giphy.com/media/abc/giphy.mp4?cid=1&ct=g",
      width: 480,
      height: 270,
    });
    expect(parseGifMessage("https://i.giphy.com/abc.mp4")).toMatchObject({ width: 480, height: 270 });
  });

  it("texto junto, outro site ou http não viram GIF", () => {
    expect(parseGifMessage("olha https://media2.giphy.com/media/abc/giphy.mp4")).toBeNull();
    expect(parseGifMessage("https://evil.example/giphy.mp4")).toBeNull();
    expect(parseGifMessage("https://giphy.com.evil.example/media/a/giphy.mp4")).toBeNull();
    expect(parseGifMessage("http://media2.giphy.com/media/abc/giphy.mp4")).toBeNull();
  });
});
