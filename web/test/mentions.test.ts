import { describe, expect, it } from "vitest";
import { mentionsUser, splitMention } from "../src/chat/mentions.ts";

describe("menções", () => {
  it("acha a menção em qualquer lugar da frase, sem diferenciar maiúsculas", () => {
    expect(mentionsUser("@diego bora?", "diego")).toBe(true);
    expect(mentionsUser("bora, @Diego!", "diego")).toBe(true);
    expect(mentionsUser("valeu @diego.", "diego")).toBe(true);
    expect(mentionsUser("(@diego)", "diego")).toBe(true);
  });

  it("não confunde com outro usuário, e-mail ou palavra", () => {
    expect(mentionsUser("@diegao chegou", "diego")).toBe(false);
    expect(mentionsUser("@diego.silva chegou", "diego")).toBe(false);
    expect(mentionsUser("@diego_2 chegou", "diego")).toBe(false);
    expect(mentionsUser("manda pra joao@diego.com", "diego")).toBe(false);
    expect(mentionsUser("diego, vem", "diego")).toBe(false);
  });

  it("usuários com ponto e hífen no nome", () => {
    expect(mentionsUser("oi @ana.paula", "ana.paula")).toBe(true);
    expect(mentionsUser("oi @anaxpaula", "ana.paula")).toBe(false); // o ponto não vira curinga
    expect(mentionsUser("oi @jo-ao", "jo-ao")).toBe(true);
  });

  it("separa a pontuação colada na menção", () => {
    const known = (u: string) => ["diego", "ana.paula"].includes(u);
    expect(splitMention("@diego.", known)).toEqual({ mention: "@diego", rest: "." });
    expect(splitMention("@ana.paula", known)).toEqual({ mention: "@ana.paula", rest: "" });
    expect(splitMention("@Diego", known)).toEqual({ mention: "@Diego", rest: "" });
    expect(splitMention("@ninguem.", known)).toBeNull();
  });
});
