import { describe, expect, it } from "vitest";
import { decideNotify, notificationBody } from "../src/lib/notify.ts";

const base = { mine: false, focused: false, inActiveChannel: false, mentioned: false, mode: "all" as const };
const att = (mime: string) => ({ id: "a", filename: "f", mime, size: 1, url: "/x", inline: true });

describe("quando avisar", () => {
  it("janela em segundo plano: avisa conforme a preferência", () => {
    expect(decideNotify(base)).toBe("notify");
    expect(decideNotify({ ...base, inActiveChannel: true })).toBe("notify"); // minimizado no próprio canal
    expect(decideNotify({ ...base, mode: "mentions" })).toBe("none");
    expect(decideNotify({ ...base, mode: "mentions", mentioned: true })).toBe("notify");
    expect(decideNotify({ ...base, mode: "none", mentioned: true })).toBe("none");
  });

  it("janela em foco: nada de notificação; só o som se te mencionarem em outro canal", () => {
    expect(decideNotify({ ...base, focused: true })).toBe("none");
    expect(decideNotify({ ...base, focused: true, mentioned: true })).toBe("sound");
    expect(decideNotify({ ...base, focused: true, mentioned: true, inActiveChannel: true })).toBe("none");
  });

  it("nunca avisa das próprias mensagens", () => {
    expect(decideNotify({ ...base, mine: true, mentioned: true })).toBe("none");
  });
});

describe("texto da notificação", () => {
  it("tira a marcação e encurta textos longos", () => {
    expect(notificationBody({ content: "**bora** ~~jogar~~ `cs`?", attachments: [] })).toBe("bora jogar cs?");
    const long = notificationBody({ content: "a".repeat(300), attachments: [] });
    expect(long).toHaveLength(140);
    expect(long.endsWith("…")).toBe(true);
  });

  it("descreve anexos quando não há texto", () => {
    expect(notificationBody({ content: "", attachments: [att("image/png")] })).toBe("Enviou uma imagem");
    expect(notificationBody({ content: "", attachments: [att("image/png"), att("image/gif")] })).toBe("Enviou 2 imagens");
    expect(notificationBody({ content: "", attachments: [att("application/octet-stream")] })).toBe("Enviou um arquivo");
  });
});

describe("quem entrou na voz", () => {
  const m = (...ids: string[]) => ids.map((userId) => ({ userId }));
  it("só quem chegou agora, sem você", async () => {
    const { joinedMembers } = await import("../src/lib/notify.ts");
    expect(joinedMembers(m("ana"), m("ana", "bia", "eu"), "eu", 1_000_000, new Map())).toEqual(["bia"]);
  });

  it("quem caiu e voltou em menos de 1 minuto não conta", async () => {
    const { joinedMembers } = await import("../src/lib/notify.ts");
    const left = new Map<string, number>();
    expect(joinedMembers(m("ana", "bia"), m("ana"), "eu", 1_000_000, left)).toEqual([]);
    expect(joinedMembers(m("ana"), m("ana", "bia"), "eu", 1_030_000, left)).toEqual([]);
    expect(joinedMembers(m("ana"), m("ana", "bia"), "eu", 1_090_000, left)).toEqual(["bia"]);
  });
});
