/**
 * Perfis de qualidade da transmissão de tela, escolhidos por quem transmite.
 *
 * Só importa TIPOS do livekit-client (apagados na compilação), para este arquivo
 * ser testável sem navegador.
 */
import type { ScreenShareCaptureOptions, TrackPublishOptions } from "livekit-client";

export type ScreenQualityId = "text" | "high" | "games" | "max";

export interface ScreenQuality {
  id: ScreenQualityId;
  label: string;
  /** Para que serve, em linguagem simples. */
  hint: string;
  width: number;
  height: number;
  fps: number;
  /** Teto da camada principal, em bits por segundo. */
  maxBitrate: number;
  /** Diz ao navegador o que priorizar quando a internet aperta. */
  contentHint?: "text" | "detail" | "motion";
  degradation: RTCDegradationPreference;
}

export const SCREEN_QUALITIES: readonly ScreenQuality[] = [
  {
    id: "text",
    label: "Texto nítido",
    hint: "Código, documentos e planilhas. Prioriza a nitidez.",
    width: 1920,
    height: 1080,
    fps: 15,
    maxBitrate: 4_000_000,
    contentHint: "text",
    degradation: "maintain-resolution",
  },
  {
    id: "high",
    label: "Alta",
    hint: "Bom para quase tudo: navegar, vídeos, apresentações.",
    width: 1920,
    height: 1080,
    fps: 30,
    maxBitrate: 6_000_000,
    degradation: "balanced",
  },
  {
    id: "games",
    label: "Jogos",
    hint: "Movimento suave. Se a internet apertar, mantém os 60 fps.",
    width: 1920,
    height: 1080,
    fps: 60,
    maxBitrate: 9_000_000,
    contentHint: "motion",
    degradation: "maintain-framerate",
  },
  {
    id: "max",
    label: "Máxima",
    hint: "Até 1440p a 60 fps. Exige boa internet e um PC mais forte de quem transmite.",
    width: 2560,
    height: 1440,
    fps: 60,
    maxBitrate: 14_000_000,
    contentHint: "motion",
    degradation: "balanced",
  },
];

export const DEFAULT_SCREEN_QUALITY: ScreenQualityId = "high";

export function screenQuality(id: string | null | undefined): ScreenQuality {
  return SCREEN_QUALITIES.find((q) => q.id === id) ?? SCREEN_QUALITIES.find((q) => q.id === DEFAULT_SCREEN_QUALITY)!;
}

/**
 * Upload aproximado de quem transmite: a camada principal mais a cópia em meia
 * resolução que o LiveKit envia para quem está com a janela pequena (1/4 da área).
 */
export function uploadMbps(q: ScreenQuality): number {
  return (q.maxBitrate * 1.25) / 1_000_000;
}

/** Som da tela (jogo, música, vídeo): estéreo a 128 kbps, igual a AudioPresets.musicHighQualityStereo. */
const SCREEN_AUDIO = { maxBitrate: 128_000 };

export function screenShareOptions(q: ScreenQuality): {
  capture: ScreenShareCaptureOptions;
  publish: TrackPublishOptions;
} {
  return {
    capture: {
      audio: true,
      systemAudio: "include",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
      // Teto de captura: telas maiores são reduzidas; menores ficam como estão.
      resolution: { width: q.width, height: q.height, frameRate: q.fps },
      ...(q.contentHint ? { contentHint: q.contentHint } : {}),
    },
    publish: {
      screenShareEncoding: { maxBitrate: q.maxBitrate, maxFramerate: q.fps, priority: "high" },
      degradationPreference: q.degradation,
      audioPreset: SCREEN_AUDIO,
      // DTX corta "silêncios", o que estraga música e efeitos baixos de jogo.
      dtx: false,
    },
  };
}
