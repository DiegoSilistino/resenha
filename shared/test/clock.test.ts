import { describe, expect, it } from "vitest";
import { ClockSync } from "../src/clock.ts";

describe("ClockSync", () => {
  it("começa sem deslocamento", () => {
    const c = new ClockSync();
    expect(c.offset).toBe(0);
    expect(c.hasSamples).toBe(false);
  });

  it("estima o deslocamento com latência simétrica", () => {
    const c = new ClockSync();
    // servidor 5 s adiantado, 100 ms de ida e volta
    c.addSample(1_000, 6_050, 1_100);
    expect(c.offset).toBe(5_000);
    expect(c.serverNow(2_000)).toBe(7_000);
  });

  it("prefere amostras de menor latência e ignora picos", () => {
    const c = new ClockSync();
    c.addSample(0, 5_020, 40); // boa: offset 5000
    c.addSample(0, 5_015, 30); // boa: offset 5000
    c.addSample(0, 5_025, 50); // boa: offset 5000
    c.addSample(0, 9_000, 2_000); // pico de 2 s: deve ser ignorado
    expect(c.offset).toBe(5_000);
  });

  it("descarta amostras inválidas", () => {
    const c = new ClockSync();
    c.addSample(100, 0, 50); // t1 < t0
    c.addSample(Number.NaN, 0, 50);
    expect(c.hasSamples).toBe(false);
  });
});
