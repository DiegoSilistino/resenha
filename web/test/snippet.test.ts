import { describe, expect, it } from "vitest";
import { channelIdFromPath, parseSnippet } from "../src/search/snippet.ts";

describe("trecho da busca", () => {
  it("separa os termos encontrados do resto", () => {
    expect(parseSnippet("…levo \u0001PIZZA\u0002 de \u0001calabresa\u0002 hoje")).toEqual([
      { text: "…levo ", hit: false },
      { text: "PIZZA", hit: true },
      { text: " de ", hit: false },
      { text: "calabresa", hit: true },
      { text: " hoje", hit: false },
    ]);
  });

  it("marcador solto ou vazio não quebra e não aparece", () => {
    expect(parseSnippet("abc \u0001def")).toEqual([{ text: "abc def", hit: false }]);
    expect(parseSnippet("a\u0001\u0002b")).toEqual([{ text: "ab", hit: false }]);
    expect(parseSnippet("")).toEqual([]);
  });

  it("termos colados viram um destaque só", () => {
    expect(parseSnippet("\u0001bo\u0002\u0001la\u0002!")).toEqual([
      { text: "bola", hit: true },
      { text: "!", hit: false },
    ]);
  });

  it("lê o canal do endereço", () => {
    expect(channelIdFromPath("/c/abc123")).toBe("abc123");
    expect(channelIdFromPath("/c/abc123/extra")).toBe("abc123");
    expect(channelIdFromPath("/convite/x")).toBeNull();
  });
});
