import { describe, expect, it } from "vitest";
import { SOUNDS, soundDuration, type SoundName } from "../src/lib/sounds.ts";

describe("sons", () => {
  it("todos são curtos e audíveis (nada de frequência estranha ou duração longa)", () => {
    for (const [name, tones] of Object.entries(SOUNDS)) {
      expect(tones.length, name).toBeGreaterThan(0);
      expect(soundDuration(name as SoundName), name).toBeLessThanOrEqual(0.35);
      for (const t of tones) {
        for (const f of [t.from, t.to ?? t.from]) {
          expect(f, name).toBeGreaterThan(200);
          expect(f, name).toBeLessThan(4000);
        }
        expect(t.dur, name).toBeGreaterThan(0.05);
      }
    }
  });

  it("pares opostos soam espelhados: entrar sobe, sair desce", () => {
    const pitch = (n: SoundName) => SOUNDS[n].map((t) => t.to ?? t.from);
    expect(pitch("join")[0]!).toBeLessThan(pitch("join").at(-1)!);
    expect(pitch("leave")[0]!).toBeGreaterThan(pitch("leave").at(-1)!);
    expect(SOUNDS.mute[0]!.to!).toBeLessThan(SOUNDS.mute[0]!.from);
    expect(SOUNDS.unmute[0]!.to!).toBeGreaterThan(SOUNDS.unmute[0]!.from);
  });
});
