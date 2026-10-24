import { describe, expect, it } from "vitest";
import { isSingleEmoji, reactionEmojiSchema } from "../src/protocol.ts";

describe("emoji de reação", () => {
  it("aceita emojis simples, com tom de pele, bandeiras e combinações", () => {
    for (const e of ["👍", "😂", "❤️", "🔥", "👍🏽", "🇧🇷", "👨‍👩‍👧", "🏳️‍🌈", "💀"]) {
      expect(isSingleEmoji(e), e).toBe(true);
    }
  });

  it("recusa texto, vários emojis e caracteres soltos", () => {
    for (const e of ["", "a", "kkk", "👍👍", "👍 ", " 👍", "<script>", "1", "#", "‍", "😂x"]) {
      expect(isSingleEmoji(e), JSON.stringify(e)).toBe(false);
    }
  });

  it("o schema devolve erro legível", () => {
    const r = reactionEmojiSchema.safeParse("oi");
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("Emoji inválido");
  });
});
