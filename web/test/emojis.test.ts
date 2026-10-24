import { describe, expect, it } from "vitest";
import { isSingleEmoji } from "@resenha/shared";
import { EMOJI_CATEGORIES, emojiName, QUICK_REACTIONS, searchEmojis } from "../src/chat/emojis.ts";

describe("emojis do seletor", () => {
  const all = EMOJI_CATEGORIES.flatMap((c) => c.emojis.map(([e]) => e));

  it("todos são aceitos pelo servidor (um emoji só) e não se repetem", () => {
    for (const e of [...all, ...QUICK_REACTIONS]) expect(isSingleEmoji(e), e).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });

  it("os da barra rápida também estão no seletor", () => {
    for (const e of QUICK_REACTIONS) expect(all).toContain(e);
  });

  it("busca sem acento, por começo de palavra", () => {
    expect(searchEmojis("risada")).toContain("😂");
    expect(searchEmojis("coracao")).toContain("❤️");
    expect(searchEmojis("CORAÇÃO PARTIDO")).toEqual(["💔"]);
    expect(searchEmojis("cerv")).toEqual(expect.arrayContaining(["🍺", "🍻"]));
    expect(searchEmojis("")).toEqual([]);
    expect(searchEmojis("xyzxyz")).toEqual([]);
  });

  it("nome legível para leitores de tela", () => {
    expect(emojiName("👍")).toBe("joinha");
    expect(emojiName("🫨")).toBe("🫨");
  });
});
