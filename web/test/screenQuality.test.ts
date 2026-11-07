import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCREEN_QUALITY,
  SCREEN_QUALITIES,
  screenQuality,
  screenShareOptions,
  screenShareErrorAdvice,
  uploadMbps,
} from "../src/voice/screenQuality.ts";

describe("perfis de qualidade da tela", () => {
  it("ids únicos e o padrão existe", () => {
    const ids = SCREEN_QUALITIES.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_SCREEN_QUALITY);
  });

  it("todos ficam acima da configuração antiga (1080p30 a 5 Mbps), exceto o de texto, que troca fps por nitidez", () => {
    for (const q of SCREEN_QUALITIES) {
      if (q.id === "text") continue;
      expect(q.maxBitrate).toBeGreaterThan(5_000_000);
      expect(q.height).toBeGreaterThanOrEqual(1080);
    }
  });

  it("bits por pixel por quadro ficam numa faixa saudável (nem desperdício, nem borrão)", () => {
    for (const q of SCREEN_QUALITIES) {
      const bpp = q.maxBitrate / (q.width * q.height * q.fps);
      expect(bpp, q.id).toBeGreaterThan(0.06);
      expect(bpp, q.id).toBeLessThan(0.15);
    }
  });

  it("id desconhecido ou vazio cai no padrão", () => {
    expect(screenQuality("inexistente").id).toBe(DEFAULT_SCREEN_QUALITY);
    expect(screenQuality(null).id).toBe(DEFAULT_SCREEN_QUALITY);
  });

  it("monta as opções do LiveKit a partir do perfil", () => {
    const { capture, publish } = screenShareOptions(screenQuality("games"));
    expect(capture.resolution).toEqual({ width: 1920, height: 1080, frameRate: 60 });
    expect(capture.contentHint).toBe("motion");
    // som do sistema sem as vozes da própria call (evita eco para a turma) e sem o
    // tratamento de voz do navegador (que abafa jogo e música), em estéreo
    expect(capture.audio).toEqual({
      restrictOwnAudio: true,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
    });
    expect(publish.screenShareEncoding).toEqual({ maxBitrate: 9_000_000, maxFramerate: 60, priority: "high" });
    expect(publish.degradationPreference).toBe("maintain-framerate");
    expect(publish.dtx).toBe(false);
    expect(publish.red).toBe(false);
    expect(publish.forceStereo).toBe(true);
    expect(publish.audioPreset?.maxBitrate).toBe(128_000);
  });

  it("perfil sem dica de conteúdo não envia contentHint", () => {
    expect(screenShareOptions(screenQuality("high")).capture).not.toHaveProperty("contentHint");
  });

  it("uma camada só: mesma qualidade no quadro pequeno e em tela cheia", () => {
    expect(screenShareOptions(screenQuality("games")).publish.simulcast).toBe(false);
    expect(uploadMbps(screenQuality("games"))).toBeCloseTo(9);
  });
});

describe("diagnóstico de falha ao transmitir", () => {
  const err = (name: string, message = "") => Object.assign(new Error(message), { name });

  it("cancelar a janela de escolha não gera aviso", () => {
    expect(screenShareErrorAdvice(err("NotAllowedError", "Permission denied"), "high").message).toBeNull();
  });

  it("falha de vídeo num perfil pesado sugere o Alta", () => {
    const a = screenShareErrorAdvice(err("NotReadableError", "Could not start video source"), "games");
    expect(a.retryWith).toBe("high");
    expect(a.message).toMatch(/Jogos/);
  });

  it("falha de vídeo já no Alta explica o bloqueio do Windows, sem sugerir repetir", () => {
    const a = screenShareErrorAdvice(err("NotReadableError", "Could not start video source"), "high");
    expect(a.retryWith).toBeUndefined();
    expect(a.message).toMatch(/OBS|anti-cheat/);
  });

  it("falha de áudio reabre no mesmo perfil, sem som, e aponta os aprimoramentos de áudio", () => {
    const a = screenShareErrorAdvice(err("NotReadableError", "Could not start audio source"), "games");
    expect(a.retryWith).toBe("games");
    expect(a.retryWithoutAudio).toBe(true);
    expect(a.message).toMatch(/Aprimoramentos de áudio/);
    expect(a.message).toMatch(/surround/);
  });

  it("sem som: não pede áudio ao navegador", () => {
    const { capture } = screenShareOptions(screenQuality("high"), { audio: false });
    expect(capture.audio).toBe(false);
    expect(capture.systemAudio).toBe("exclude");
    expect(screenShareOptions(screenQuality("high")).capture.audio).toMatchObject({ restrictOwnAudio: true });
  });

  it("erro desconhecido mostra o detalhe técnico", () => {
    expect(screenShareErrorAdvice(err("WeirdError", "algo raro"), "high").message).toMatch(/algo raro/);
  });
});
