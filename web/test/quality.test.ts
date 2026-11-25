import { describe, expect, it } from "vitest";
import { parsePing, qualityInfo } from "../src/voice/quality.ts";

describe("ping que chega pela sala", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  it("aceita só um número razoável de ms (arredondado)", () => {
    expect(parsePing(bytes('{"ms":42.6}'))).toBe(43);
    expect(parsePing(bytes('{"ms":0}'))).toBeNull();
    expect(parsePing(bytes('{"ms":99999}'))).toBeNull();
    expect(parsePing(bytes('{"ms":"42"}'))).toBeNull();
    expect(parsePing(bytes("lixo"))).toBeNull();
  });
});

describe("qualidade da conexão", () => {
  it("mapeia os níveis do LiveKit para barras e cores", () => {
    expect(qualityInfo("excellent")).toMatchObject({ bars: 3, tone: "good" });
    expect(qualityInfo("good")).toMatchObject({ bars: 2, tone: "fair" });
    expect(qualityInfo("poor")).toMatchObject({ bars: 1, tone: "bad" });
    expect(qualityInfo("lost")).toMatchObject({ bars: 0, tone: "bad" });
    expect(qualityInfo(undefined)).toMatchObject({ bars: 0, tone: "none" });
  });
});
