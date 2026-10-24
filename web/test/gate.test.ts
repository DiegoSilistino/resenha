import { describe, expect, it } from "vitest";
import { blockDb, GATE, GateEngine } from "../src/voice/gate/engine.ts";

const BLOCK_MS = (128 / 48_000) * 1000; // um bloco do Web Audio a 48 kHz (~2,7 ms)
const blocksFor = (ms: number) => Math.ceil(ms / BLOCK_MS);

/** Roda `ms` milissegundos no volume `db` e devolve o estado final. */
function feed(engine: GateEngine, db: number, ms: number): boolean {
  let open = false;
  for (let i = 0; i < blocksFor(ms); i++) open = engine.step(db, BLOCK_MS);
  return open;
}

const manual = (thresholdDb = -50) => new GateEngine({ enabled: true, auto: false, thresholdDb });

describe("portão do microfone", () => {
  it("silêncio fica fechado; fala abre", () => {
    const g = manual();
    expect(feed(g, -75, 500)).toBe(false);
    expect(feed(g, -25, 100)).toBe(true);
  });

  it("estalo curto (tecla) não abre, mas fala sustentada sim", () => {
    const g = manual();
    feed(g, -75, 200);
    expect(feed(g, -20, GATE.confirmMs / 2)).toBe(false); // ~4 ms de estalo
    expect(feed(g, -75, 50)).toBe(false);
    expect(feed(g, -20, GATE.confirmMs + 3)).toBe(true);
  });

  it("segura aberto entre palavras e fecha depois do tempo de espera", () => {
    const g = manual();
    feed(g, -25, 300);
    expect(feed(g, -75, GATE.holdMs - 40)).toBe(true); // pausa curta: continua
    expect(feed(g, -25, 50)).toBe(true);
    expect(feed(g, -75, GATE.holdMs + 20)).toBe(false); // terminou de falar
  });

  it("desligado: tudo passa", () => {
    const g = new GateEngine({ enabled: false, auto: true, thresholdDb: -50 });
    expect(feed(g, -90, 300)).toBe(true);
  });

  it("automático: em sala silenciosa o limiar fica baixo e a fala passa", () => {
    const g = new GateEngine({ enabled: true, auto: true, thresholdDb: -50 });
    feed(g, -80, 3_000);
    expect(g.thresholdDb).toBe(GATE.autoMinDb);
    expect(feed(g, -35, 100)).toBe(true);
  });

  it("automático: se adapta a um ventilador ligado e volta a fechar", () => {
    const g = new GateEngine({ enabled: true, auto: true, thresholdDb: -50 });
    feed(g, -75, 2_000);
    feed(g, -52, 60_000); // ruído constante mais alto que antes
    expect(g.thresholdDb).toBeGreaterThan(-52);
    expect(feed(g, -52, 1_000)).toBe(false);
    // e a fala por cima do ventilador continua passando
    expect(feed(g, -25, 100)).toBe(true);
  });

  it("automático: um monólogo longo não fecha o portão no meio", () => {
    const g = new GateEngine({ enabled: true, auto: true, thresholdDb: -50 });
    feed(g, -70, 2_000);
    for (let i = 0; i < 40; i++) {
      // 40 frases de ~1 s com respiros curtos
      expect(feed(g, -28, 900)).toBe(true);
      feed(g, -70, 150);
    }
    expect(g.thresholdDb).toBeLessThanOrEqual(GATE.autoMaxDb);
  });

  it("microfone mudo (silêncio digital) não derruba a estimativa de ruído", () => {
    const g = new GateEngine({ enabled: true, auto: true, thresholdDb: -50 });
    feed(g, -55, 10_000);
    const before = g.floorDb;
    feed(g, -120, 10_000);
    expect(g.floorDb).toBe(before);
  });

  it("calcula o volume em dBFS", () => {
    expect(blockDb(new Float32Array(128))).toBe(-120);
    expect(blockDb(new Float32Array(128).fill(1))).toBeCloseTo(0);
    expect(blockDb(new Float32Array(128).fill(0.1))).toBeCloseTo(-20);
  });
});
