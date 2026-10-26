import { describe, expect, it } from "vitest";
import { qualityInfo } from "../src/voice/quality.ts";

describe("qualidade da conexão", () => {
  it("mapeia os níveis do LiveKit para barras e cores", () => {
    expect(qualityInfo("excellent")).toMatchObject({ bars: 3, tone: "good" });
    expect(qualityInfo("good")).toMatchObject({ bars: 2, tone: "fair" });
    expect(qualityInfo("poor")).toMatchObject({ bars: 1, tone: "bad" });
    expect(qualityInfo("lost")).toMatchObject({ bars: 0, tone: "bad" });
    expect(qualityInfo(undefined)).toMatchObject({ bars: 0, tone: "none" });
  });
});
