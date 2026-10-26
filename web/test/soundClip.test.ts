import { describe, expect, it } from "vitest";
import { encodeWav, firstSoundAt, loudnessGain, waveformPeaks } from "../src/voice/soundClip.ts";

const RATE = 8_000;
const tone = (seconds: number, amp: number, offset = 0) => {
  const out = new Float32Array(Math.round((seconds + offset) * RATE));
  for (let i = Math.round(offset * RATE); i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * 440 * i) / RATE);
  return out;
};
const rms = (s: Float32Array) => Math.sqrt(s.reduce((a, v) => a + v * v, 0) / s.length);

describe("preparo do som da mesa", () => {
  it("som estourado é baixado e som baixo é subido para o mesmo nível", () => {
    const loud = tone(1, 0.99);
    const quiet = tone(1, 0.05);
    const gLoud = loudnessGain(loud, RATE);
    const gQuiet = loudnessGain(quiet, RATE);
    expect(gLoud).toBeLessThan(0.3);
    expect(gQuiet).toBeGreaterThan(1.5);
    expect(rms(loud) * gLoud).toBeCloseTo(rms(quiet) * gQuiet, 2);
  });

  it("silêncio não puxa o volume para cima (só a parte com som conta)", () => {
    const withSilence = tone(1, 0.2, 2); // 2 s mudos + 1 s de som
    const noSilence = tone(1, 0.2);
    expect(loudnessGain(withSilence, RATE)).toBeCloseTo(loudnessGain(noSilence, RATE), 2);
  });

  it("nunca passa do teto nem amplifica chiado demais", () => {
    const spike = new Float32Array(RATE).fill(0.01);
    spike[100] = 0.9;
    expect(loudnessGain(spike, RATE) * spike[100]!).toBeCloseTo(0.97, 6); // o pico fica no teto, não acima
    expect(loudnessGain(tone(1, 0.006), RATE)).toBeLessThanOrEqual(8);
    expect(loudnessGain(new Float32Array(RATE), RATE)).toBe(1); // tudo mudo
  });

  it("acha onde o som começa (com folguinha)", () => {
    expect(firstSoundAt(tone(1, 0.5, 1.5), RATE)).toBeCloseTo(1.45, 2);
    expect(firstSoundAt(new Float32Array(RATE), RATE)).toBe(0);
  });

  it("WAV PCM 16 bits mono com cabeçalho certo", async () => {
    const blob = encodeWav(new Float32Array([0, 1, -1, 2]), 44_100);
    const v = new DataView(await blob.arrayBuffer());
    const text = (at: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(at + i)));
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(44 + 8);
    expect(text(0, 4) + text(8, 4)).toBe("RIFFWAVE");
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(44_100);
    expect(v.getUint32(40, true)).toBe(8);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)]).toEqual([0, 32767, -32768, 32767]);
  });

  it("onda normalizada pelo pico", () => {
    const peaks = waveformPeaks(new Float32Array([0.1, 0.1, 0.5, -0.5, 0.2, 0]), 3);
    expect(peaks.map((p) => +p.toFixed(4))).toEqual([0.2, 1, 0.4]);
  });
});
