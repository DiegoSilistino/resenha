import { describe, expect, it } from "vitest";
import { reorderIds } from "../src/lib/rodas.ts";

describe("reorderIds (arrastar/setinhas das salas)", () => {
  const ids = ["a", "b", "c", "d"];

  it("põe antes ou depois da sala alvo", () => {
    expect(reorderIds(ids, "d", "b", false)).toEqual(["a", "d", "b", "c"]);
    expect(reorderIds(ids, "a", "c", true)).toEqual(["b", "c", "a", "d"]);
    expect(reorderIds(ids, "a", "d", true)).toEqual(["b", "c", "d", "a"]);
    expect(reorderIds(ids, "d", "a", false)).toEqual(["d", "a", "b", "c"]);
  });

  it("soltar em cima dela mesma não muda nada", () => {
    expect(reorderIds(ids, "b", "b", true)).toEqual(ids);
  });
});
