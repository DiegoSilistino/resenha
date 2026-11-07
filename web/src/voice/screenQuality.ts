/**
 * Perfis de qualidade da transmissão de tela, escolhidos por quem transmite.
 *
 * Só importa TIPOS do livekit-client (apagados na compilação), para este arquivo
 * ser testável sem navegador.
 */
import type { AudioCaptureOptions, ScreenShareCaptureOptions, TrackPublishOptions } from "livekit-client";

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

/** Upload aproximado de quem transmite (uma camada só: sem simulcast, ver screenShareOptions). */
export function uploadMbps(q: ScreenQuality): number {
  return q.maxBitrate / 1_000_000;
}

/** Som da tela (jogo, música, vídeo): estéreo a 128 kbps, igual a AudioPresets.musicHighQualityStereo. */
const SCREEN_AUDIO = { maxBitrate: 128_000 };

/**
 * Captura do som da tela como ele é, sem o tratamento feito para microfone.
 *
 * - restrictOwnAudio: tira do "som do sistema" o áudio desta própria aba (as vozes da
 *   call); sem isso, ao transmitir a tela inteira com som, a turma ouve a própria voz de
 *   volta. Navegadores que não conhecem a opção simplesmente a ignoram.
 * - Sem eco/ruído/ganho: no getDisplayMedia o Chrome liga por padrão o cancelamento de
 *   eco, a supressão de ruído e o ganho automático (feitos para voz) e mistura em mono.
 *   Em jogo e música isso abafa o som e faz o volume "respirar". O eco das vozes da call
 *   já é resolvido pelo restrictOwnAudio.
 * - channelCount 2: pede o som em estéreo.
 */
const SCREEN_AUDIO_CAPTURE = {
  restrictOwnAudio: true,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 2,
} as unknown as AudioCaptureOptions;

export function screenShareOptions(
  q: ScreenQuality,
  { audio = true }: { audio?: boolean } = {},
): {
  capture: ScreenShareCaptureOptions;
  publish: TrackPublishOptions;
} {
  return {
    capture: {
      // Sem som: o navegador nem oferece a opção de áudio, e o Windows não é consultado.
      audio: audio ? SCREEN_AUDIO_CAPTURE : false,
      systemAudio: audio ? "include" : "exclude",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
      // Teto de captura: telas maiores são reduzidas; menores ficam como estão.
      resolution: { width: q.width, height: q.height, frameRate: q.fps },
      ...(q.contentHint ? { contentHint: q.contentHint } : {}),
    },
    publish: {
      screenShareEncoding: { maxBitrate: q.maxBitrate, maxFramerate: q.fps, priority: "high" },
      degradationPreference: q.degradation,
      // Sem a cópia em meia resolução: com ela, o adaptiveStream mandava a cópia para o quadro
      // pequeno e a imagem só ficava nítida em tela cheia. Assim a qualidade é a mesma em qualquer tamanho.
      simulcast: false,
      audioPreset: SCREEN_AUDIO,
      // O LiveKit publica em mono a menos que se peça estéreo explicitamente.
      forceStereo: true,
      // DTX corta "silêncios", o que estraga música e efeitos baixos de jogo.
      dtx: false,
      // Redundância (RED) é para voz em rede ruim; aqui só dobraria o envio do som.
      red: false,
    },
  };
}

export interface ScreenShareAdvice {
  /** O que dizer para a pessoa (null = não avisar, ex.: ela cancelou). */
  message: string | null;
  /** Reabrir a escolha já com este perfil selecionado. */
  retryWith?: ScreenQualityId;
  /** Reabrir com o som desmarcado (o Windows recusou o áudio). */
  retryWithoutAudio?: boolean;
}

/**
 * Traduz a falha da captura de tela em algo acionável. O navegador diz "NotReadableError"
 * quando o Windows recusa a captura; a mensagem informa se foi o vídeo ou o som.
 */
export function screenShareErrorAdvice(err: unknown, qualityId: ScreenQualityId): ScreenShareAdvice {
  const name = (err as { name?: string } | null)?.name ?? "";
  const detail = (err as { message?: string } | null)?.message ?? "";
  const q = screenQuality(qualityId);
  const demanding = q.fps > 30 || q.height > 1080;

  if (name === "NotAllowedError") {
    // Cancelar a janela de escolha também gera NotAllowedError: aí não há o que avisar.
    return /system/i.test(detail) ? { message: "O sistema bloqueou a captura de tela neste computador." } : { message: null };
  }
  if (name === "InvalidStateError") {
    return { message: "O navegador pediu um clique novo. Clique em compartilhar a tela de novo." };
  }
  if (name === "NotReadableError" || name === "AbortError" || name === "OverconstrainedError") {
    if (/audio/i.test(detail)) {
      return {
        message:
          "O Windows não liberou o som do computador. Desative os Aprimoramentos de áudio (Configurações → Sistema → Som → seu fone → Aprimoramentos de áudio) e o surround/7.1 do software do headset. Deixei pronto para transmitir sem som por enquanto.",
        retryWith: q.id,
        retryWithoutAudio: true,
      };
    }
    if (demanding) {
      return {
        message: `O Windows não conseguiu capturar no perfil ${q.label} (${q.height}p a ${q.fps} fps) neste PC. Tente o perfil Alta, que já deixei selecionado.`,
        retryWith: "high",
      };
    }
    return {
      message:
        "O Windows bloqueou a captura dessa tela ou janela. Feche programas que gravam a tela (OBS, Xbox Game Bar), veja se não é um jogo com anti-cheat, ou compartilhe uma aba do navegador.",
    };
  }
  return { message: `Não foi possível compartilhar a tela${detail ? ` (${detail})` : ""}.` };
}
