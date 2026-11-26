/**
 * Estado da chamada, sem nada do LiveKit: pode ser lido por qualquer tela sem baixar
 * a biblioteca de voz (~520 KB), que só carrega quando a pessoa entra numa chamada.
 */
import { create } from "zustand";
import type { SoundboardSound } from "@resenha/shared";

export type VoiceStatus = "idle" | "connecting" | "connected" | "reconnecting";

export interface Caption {
  text: string;
  final: boolean;
  at: number;
}

export interface VoiceState {
  status: VoiceStatus;
  channelId: string | null;
  /** Preferências de mute/ensurdecer valem mesmo fora de uma chamada. */
  muted: boolean;
  deafened: boolean;
  screenSharing: boolean;
  cameraOn: boolean;
  pttActive: boolean;
  /** O navegador bloqueou o áudio até a pessoa clicar em algo. */
  audioBlocked: boolean;
  /** Incrementa a cada mudança na sala, para o React redesenhar. */
  version: number;
  speaking: Record<string, true>;
  captions: Record<string, Caption>;
  /** Ping (ms) de cada um até o servidor de voz: cada app mede o seu e conta para a sala. */
  pings: Record<string, number>;
  /** Som da tela silenciado por pessoa (vale até recarregar a página). */
  streamMuted: Record<string, true>;
  /** Telas dos outros que você abriu (como no Discord: vídeo e som só depois de clicar em Assistir). */
  watching: Record<string, true>;
  /** Tela fixada no quadro grande (identity de quem transmite). */
  focused: string | null;
  /** Último som da mesa tocado por pessoa (mostra a figurinha no quadradinho dela). */
  soundPlays: Record<string, { sound: SoundboardSound; at: number }>;
}

export const useVoice = create<VoiceState>()(() => ({
  status: "idle",
  channelId: null,
  muted: false,
  deafened: false,
  screenSharing: false,
  cameraOn: false,
  pttActive: false,
  audioBlocked: false,
  version: 0,
  speaking: {},
  captions: {},
  pings: {},
  streamMuted: {},
  watching: {},
  focused: null,
  soundPlays: {},
}));
