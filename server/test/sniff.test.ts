import { describe, expect, it } from "vitest";
import { sniffMime } from "../src/uploads/sniff.ts";

const bytes = (...parts: (string | number[])[]) =>
  Buffer.concat([...parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))), Buffer.alloc(16)]);

describe("tipo do anexo pelos bytes", () => {
  it("áudio comum toca no chat (inline) com o tipo certo", () => {
    expect(sniffMime(bytes("ID3"))).toEqual({ mime: "audio/mpeg", inline: true });
    expect(sniffMime(bytes([0xff, 0xfb, 0x90, 0x00]))).toEqual({ mime: "audio/mpeg", inline: true });
    expect(sniffMime(bytes("OggS"))).toEqual({ mime: "audio/ogg", inline: true });
    expect(sniffMime(bytes("RIFF", [0, 0, 0, 0], "WAVE"))).toEqual({ mime: "audio/wav", inline: true });
    expect(sniffMime(bytes("fLaC"))).toEqual({ mime: "audio/flac", inline: true });
    expect(sniffMime(bytes([0, 0, 0, 0x20], "ftypM4A "))).toEqual({ mime: "audio/mp4", inline: true });
  });

  it("imagem e vídeo continuam iguais; o resto vira download", () => {
    expect(sniffMime(bytes([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ mime: "image/jpeg", inline: true });
    expect(sniffMime(bytes("RIFF", [0, 0, 0, 0], "WEBP"))).toEqual({ mime: "image/webp", inline: true });
    expect(sniffMime(bytes([0, 0, 0, 0x20], "ftypisom"))).toEqual({ mime: "video/mp4", inline: true });
    expect(sniffMime(bytes([0, 0, 0, 0x14], "ftypqt  "))).toEqual({ mime: "video/quicktime", inline: true });
    expect(sniffMime(bytes("<svg onload=alert(1)>"))).toEqual({ mime: "application/octet-stream", inline: false });
  });
});
