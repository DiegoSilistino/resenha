import { describe, expect, it } from "vitest";
import { LIMITS } from "../src/constants.ts";
import type { WatchItem, WatchState } from "../src/types.ts";
import { createWatchState, reduceWatch, watchPositionAt } from "../src/watch.ts";

const item = (id: string): WatchItem => ({
  id,
  videoId: `vid${id.padStart(8, "0")}`,
  title: `Vídeo ${id}`,
  addedBy: "u1",
  addedAt: 0,
});

function withItems(...ids: string[]): WatchState {
  let s = createWatchState("c1");
  for (const id of ids) s = reduceWatch(s, { kind: "add", item: item(id) }, 1_000);
  return s;
}

describe("reduceWatch", () => {
  it("primeiro vídeo adicionado começa a tocar na hora", () => {
    const s = withItems("a");
    expect(s.current?.id).toBe("a");
    expect(s.playing).toBe(true);
    expect(s.startedAt).toBe(1_000);
    expect(s.queue).toEqual([]);
    expect(s.version).toBe(1);
  });

  it("os seguintes vão para a fila", () => {
    const s = withItems("a", "b", "c");
    expect(s.current?.id).toBe("a");
    expect(s.queue.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("calcula a posição pelo relógio do servidor", () => {
    const s = withItems("a");
    expect(watchPositionAt(s, 1_000)).toBe(0);
    expect(watchPositionAt(s, 31_000)).toBe(30);
    // relógio levemente atrasado nunca gera posição negativa
    expect(watchPositionAt(s, 900)).toBe(0);
  });

  it("pausa congela a posição e retomar continua de onde parou", () => {
    let s = withItems("a");
    s = reduceWatch(s, { kind: "pause" }, 11_000);
    expect(s.playing).toBe(false);
    expect(watchPositionAt(s, 99_000)).toBe(10);

    s = reduceWatch(s, { kind: "resume" }, 50_000);
    expect(s.playing).toBe(true);
    expect(watchPositionAt(s, 50_000)).toBe(10);
    expect(watchPositionAt(s, 55_000)).toBe(15);
  });

  it("seek funciona tocando e pausado, e não aceita negativo", () => {
    let s = withItems("a");
    s = reduceWatch(s, { kind: "seek", seconds: 120 }, 5_000);
    expect(watchPositionAt(s, 5_000)).toBe(120);

    s = reduceWatch(s, { kind: "pause" }, 6_000);
    s = reduceWatch(s, { kind: "seek", seconds: -5 }, 7_000);
    expect(watchPositionAt(s, 7_000)).toBe(0);
  });

  it("skip avança para o próximo e esvazia ao final", () => {
    let s = withItems("a", "b");
    s = reduceWatch(s, { kind: "skip" }, 9_000);
    expect(s.current?.id).toBe("b");
    expect(s.startedAt).toBe(9_000);
    expect(s.queue).toEqual([]);

    s = reduceWatch(s, { kind: "skip" }, 10_000);
    expect(s.current).toBeNull();
    expect(s.playing).toBe(false);
  });

  it("'ended' é idempotente: vários clientes avisando não pulam vídeos a mais", () => {
    let s = withItems("a", "b", "c");
    s = reduceWatch(s, { kind: "ended", itemId: "a" }, 2_000);
    const afterFirst = s;
    s = reduceWatch(s, { kind: "ended", itemId: "a" }, 2_001);
    s = reduceWatch(s, { kind: "ended", itemId: "a" }, 2_002);
    expect(s).toBe(afterFirst);
    expect(s.current?.id).toBe("b");
  });

  it("remover o atual avança; remover da fila só tira da fila", () => {
    let s = withItems("a", "b", "c");
    s = reduceWatch(s, { kind: "remove", itemId: "c" }, 2_000);
    expect(s.current?.id).toBe("a");
    expect(s.queue.map((i) => i.id)).toEqual(["b"]);

    s = reduceWatch(s, { kind: "remove", itemId: "a" }, 3_000);
    expect(s.current?.id).toBe("b");
  });

  it("ações sem efeito devolvem o mesmo objeto (não geram broadcast)", () => {
    const empty = createWatchState("c1");
    expect(reduceWatch(empty, { kind: "skip" }, 1)).toBe(empty);
    expect(reduceWatch(empty, { kind: "pause" }, 1)).toBe(empty);
    expect(reduceWatch(empty, { kind: "clear" }, 1)).toBe(empty);

    const playing = withItems("a");
    expect(reduceWatch(playing, { kind: "resume" }, 1)).toBe(playing);
    expect(reduceWatch(playing, { kind: "remove", itemId: "zzz" }, 1)).toBe(playing);
  });

  it("nunca altera o estado original", () => {
    const s = withItems("a", "b");
    const snapshot = structuredClone(s);
    reduceWatch(s, { kind: "skip" }, 5_000);
    reduceWatch(s, { kind: "add", item: item("c") }, 5_000);
    reduceWatch(s, { kind: "clear" }, 5_000);
    expect(s).toEqual(snapshot);
  });

  it("respeita o limite da fila", () => {
    let s = withItems("atual");
    for (let i = 0; i < LIMITS.watchQueueMax + 5; i++) {
      s = reduceWatch(s, { kind: "add", item: item(`q${i}`) }, 1);
    }
    expect(s.queue).toHaveLength(LIMITS.watchQueueMax);
  });

  it("sessão: nasce com o primeiro vídeo, continua pela fila e acaba no fim", () => {
    let s = withItems("a", "b");
    expect(s.sessionId).toBe("a");
    s = reduceWatch(s, { kind: "skip" }, 2_000);
    expect(s.current?.id).toBe("b");
    expect(s.sessionId).toBe("a"); // mesma sessão enquanto houver fila
    s = reduceWatch(s, { kind: "ended", itemId: "b" }, 3_000);
    expect(s.sessionId).toBeNull();

    s = reduceWatch(s, { kind: "add", item: item("c") }, 4_000);
    expect(s.sessionId).toBe("c"); // sessão nova, outra identidade
  });

  it("encerrar (clear) acaba a sessão", () => {
    const s = reduceWatch(withItems("a", "b"), { kind: "clear" }, 2_000);
    expect(s).toMatchObject({ sessionId: null, current: null, queue: [], playing: false });
  });
});
