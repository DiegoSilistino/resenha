import { describe, expect, it } from "vitest";
import { initialCrop, MAX_ZOOM, moveCrop, sourceRect, zoomCrop } from "../src/modals/crop.ts";

const VIEW = 240;

describe("recorte da foto", () => {
  it("foto deitada começa centralizada, cobrindo o quadro pela altura", () => {
    const c = initialCrop(1200, 800, VIEW);
    expect(sourceRect(c, 1200, 800, VIEW)).toEqual({ sx: 200, sy: 0, size: 800 });
  });

  it("arrastar não deixa sobrar fundo vazio", () => {
    let c = initialCrop(1200, 800, VIEW);
    c = moveCrop(c, 10_000, 10_000, 1200, 800, VIEW);
    expect(sourceRect(c, 1200, 800, VIEW)).toMatchObject({ sx: 0, sy: 0 });
    c = moveCrop(c, -10_000, -10_000, 1200, 800, VIEW);
    const r = sourceRect(c, 1200, 800, VIEW);
    expect(r.sx + r.size).toBeCloseTo(1200);
    expect(r.sy + r.size).toBeCloseTo(800);
  });

  it("zoom aproxima mantendo o centro, com limite", () => {
    const c = zoomCrop(initialCrop(1000, 1000, VIEW), 2, 1000, 1000, VIEW);
    expect(sourceRect(c, 1000, 1000, VIEW)).toEqual({ sx: 250, sy: 250, size: 500 });
    expect(zoomCrop(c, 99, 1000, 1000, VIEW).zoom).toBe(MAX_ZOOM);
    expect(zoomCrop(c, 0.1, 1000, 1000, VIEW).zoom).toBe(1);
  });

  it("afastar o zoom perto da borda puxa a imagem de volta para cobrir o quadro", () => {
    let c = zoomCrop(initialCrop(1000, 1000, VIEW), 3, 1000, 1000, VIEW);
    c = moveCrop(c, 10_000, 0, 1000, 1000, VIEW); // encostado na esquerda
    c = zoomCrop(c, 1, 1000, 1000, VIEW);
    expect(sourceRect(c, 1000, 1000, VIEW)).toEqual({ sx: 0, sy: 0, size: 1000 });
  });
});
