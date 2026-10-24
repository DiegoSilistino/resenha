import { describe, expect, it } from "vitest";
import { imageInfo } from "../src/uploads/image.ts";
import { jpeg, png, webpExtended, webpLossless, webpLossy } from "./images.ts";

describe("dimensões pelo cabeçalho", () => {
  it("PNG, inclusive animado (APNG)", () => {
    expect(imageInfo(png(300, 200))).toEqual({ mime: "image/png", width: 300, height: 200, animated: false });
    expect(imageInfo(png(64, 64, { animated: true }))?.animated).toBe(true);
  });

  it("JPEG (pula os segmentos até o SOF)", () => {
    expect(imageInfo(jpeg(1024, 768))).toEqual({ mime: "image/jpeg", width: 1024, height: 768, animated: false });
  });

  it("os três tipos de WebP", () => {
    expect(imageInfo(webpLossless(256, 256))).toMatchObject({ mime: "image/webp", width: 256, height: 256 });
    expect(imageInfo(webpLossy(640, 480))).toMatchObject({ width: 640, height: 480 });
    expect(imageInfo(webpExtended(4000, 3000))).toMatchObject({ width: 4000, height: 3000, animated: false });
    expect(imageInfo(webpExtended(100, 100, { animated: true }))?.animated).toBe(true);
  });

  it("recusa o que não é imagem ou está truncado, sem lançar erro", () => {
    expect(imageInfo(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(imageInfo(Buffer.from("GIF89a......"))).toBeNull();
    expect(imageInfo(png(10, 10).subarray(0, 18))).toBeNull();
    expect(imageInfo(jpeg(10, 10).subarray(0, 12))).toBeNull();
    expect(imageInfo(Buffer.alloc(0))).toBeNull();
  });
});
