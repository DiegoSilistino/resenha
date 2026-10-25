import { describe, expect, it } from "vitest";
import { participantVolumes } from "../src/voice/volumes.ts";

const base = { deafened: false, voice: undefined, stream: undefined, streamMuted: false };

describe("volume por pessoa", () => {
  it("sem preferência: tudo em 100%", () => {
    expect(participantVolumes(base)).toEqual({ voice: 1, stream: 1 });
  });

  it("voz e som da tela são independentes", () => {
    expect(participantVolumes({ ...base, voice: 1.5, stream: 0.3 })).toEqual({ voice: 1.5, stream: 0.3 });
  });

  it("silenciar a tela não mexe na voz", () => {
    expect(participantVolumes({ ...base, voice: 0.8, stream: 0.5, streamMuted: true })).toEqual({ voice: 0.8, stream: 0 });
  });

  it("ensurdecido não ouve nada", () => {
    expect(participantVolumes({ ...base, deafened: true, voice: 2, stream: 2 })).toEqual({ voice: 0, stream: 0 });
  });

  it("limita a 0–200% mesmo com valor estranho salvo", () => {
    expect(participantVolumes({ ...base, voice: 9, stream: -1 })).toEqual({ voice: 2, stream: 0 });
  });
});
