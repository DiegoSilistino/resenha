import { describe, expect, it } from "vitest";
import { createWatchState, reduceWatch, type WatchItem } from "@resenha/shared";
import { watchVisibility } from "../src/watch/visibility.ts";

const item = (id: string): WatchItem => ({ id, videoId: "dQw4w9WgXcQ", title: id, addedBy: "u", addedAt: 0 });
const playing = (id = "a") => reduceWatch(createWatchState("c"), { kind: "add", item: item(id) }, 0);

describe("watchVisibility", () => {
  it("sem nada tocando: nada aparece até abrir o painel", () => {
    const idle = createWatchState("c");
    expect(watchVisibility(idle, undefined, false)).toMatchObject({ active: false, playerVisible: false, areaVisible: false });
    expect(watchVisibility(idle, undefined, true)).toMatchObject({ active: false, playerVisible: false, areaVisible: true });
    expect(watchVisibility(undefined, undefined, false).areaVisible).toBe(false);
  });

  it("alguém começou um vídeo: aparece para todo mundo, mesmo sem abrir o painel", () => {
    expect(watchVisibility(playing(), undefined, false)).toMatchObject({ active: true, playerVisible: true, areaVisible: true });
  });

  it("esconder vale só para a sessão atual", () => {
    const s = playing("a");
    expect(watchVisibility(s, "a", false)).toMatchObject({ active: true, playerVisible: false, areaVisible: false });

    // a fila andou: mesma sessão, continua escondido
    const next = reduceWatch(reduceWatch(s, { kind: "add", item: item("b") }, 1), { kind: "skip" }, 2);
    expect(next.sessionId).toBe("a");
    expect(watchVisibility(next, "a", false).playerVisible).toBe(false);

    // sessão nova (alguém começou outro vídeo depois de acabar): reaparece
    const ended = reduceWatch(next, { kind: "clear" }, 3);
    const fresh = reduceWatch(ended, { kind: "add", item: item("c") }, 4);
    expect(watchVisibility(fresh, "a", false).playerVisible).toBe(true);
  });

  it("painel aberto não força o player escondido a reaparecer", () => {
    expect(watchVisibility(playing("a"), "a", true).playerVisible).toBe(false);
  });

  it("compatível com servidor sem sessionId", () => {
    const old = { ...playing("a"), sessionId: undefined as unknown as null };
    expect(watchVisibility(old, undefined, false)).toMatchObject({ active: true, sessionId: "a" });
  });
});
