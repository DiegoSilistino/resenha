import { describe, expect, it } from "vitest";
import { parseGifMessage, plainText } from "../src/chat/plain.ts";

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
