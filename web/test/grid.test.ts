import { describe, expect, it } from "vitest";
import { fitGrid } from "../src/voice/grid.ts";

describe("grade da chamada", () => {
  it("uma pessoa ocupa a área toda, limitada pela altura", () => {
    expect(fitGrid(1, 1000, 450, 0, 16 / 9)).toEqual({ cols: 1, tileWidth: 800 });
  });

  it("quatro numa área quase quadrada viram 2×2", () => {
    expect(fitGrid(4, 1000, 600, 0, 16 / 9).cols).toBe(2);
  });

  it("quatro numa faixa larga ficam numa linha só", () => {
    expect(fitGrid(4, 2000, 400, 0, 16 / 9).cols).toBe(4);
  });

  it("mais gente, quadros menores, e todos cabem", () => {
    const gap = 12;
    let last = Infinity;
    for (let n = 1; n <= 12; n++) {
      const { cols, tileWidth } = fitGrid(n, 1200, 700, gap, 16 / 9);
      const rows = Math.ceil(n / cols);
      expect(tileWidth).toBeLessThanOrEqual(last);
      expect(cols * tileWidth + (cols - 1) * gap).toBeLessThanOrEqual(1200);
      expect(rows * (tileWidth / (16 / 9)) + (rows - 1) * gap).toBeLessThanOrEqual(700);
      last = tileWidth;
    }
  });
});
