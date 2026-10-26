import { describe, expect, it } from "vitest";
import { describeUserAgent } from "../src/lib/userAgent.ts";

describe("navegador no painel de erros", () => {
  it("reconhece os navegadores do Windows", () => {
    const base = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)";
    expect(describeUserAgent(`${base} Chrome/141.0.0.0 Safari/537.36`)).toBe("Chrome 141 · Windows");
    expect(describeUserAgent(`${base} Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0`)).toBe("Edge 141 · Windows");
    expect(describeUserAgent(`${base} Chrome/140.0.0.0 Safari/537.36 OPR/124.0.0.0`)).toBe("Opera 124 · Windows");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0")).toBe(
      "Firefox 144 · Windows",
    );
  });

  it("desconhecido não quebra", () => {
    expect(describeUserAgent("")).toBe("Navegador desconhecido");
  });
});
