import { describe, expect, it } from "vitest";
import { isStaleChunkError } from "../src/lib/chunks.ts";

describe("arquivo de versão antiga", () => {
  it("reconhece as mensagens do Chrome, Firefox e Safari", () => {
    expect(isStaleChunkError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/room-abc.js"))).toBe(true);
    expect(isStaleChunkError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isStaleChunkError(new TypeError("Importing a module script failed."))).toBe(true);
  });

  it("não confunde com outros erros", () => {
    expect(isStaleChunkError(new Error("x is not a function"))).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});
