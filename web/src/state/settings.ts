import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_SCREEN_QUALITY, type ScreenQualityId } from "../voice/screenQuality.ts";

/** Preferências deste aparelho (ficam no navegador, não no servidor). */
export interface Settings {
  micDeviceId: string | null;
  speakerDeviceId: string | null;
  /**
   * Redução de ruído: "ai" = GTCRN (tira teclado até durante a fala), "browser" = a do
   * navegador (só ruído constante), "off" = som puro.
   */
  noiseMode: NoiseMode;
  echoCancellation: boolean;
  pttEnabled: boolean;
  /** KeyboardEvent.code da tecla do push-to-talk */
  pttKey: string;
  /** volume da voz por pessoa, 0 a 2 (200%) */
  userVolumes: Record<string, number>;
  /** volume do som da tela (jogo, vídeo) por pessoa, 0 a 2 (200%) */
  streamVolumes: Record<string, number>;
  captionsView: boolean;
  /** Consentimento explícito: a fala vai para o reconhecimento de voz do navegador. */
  transcribe: boolean;
  captionsLang: string;
  watchVolume: number;
  /** Último perfil de qualidade usado para transmitir a tela. */
  screenQuality: ScreenQualityId;
  /** Transmitir também o som do computador junto com a tela. */
  screenAudio: boolean;
  /** Só transmite o microfone quando o volume passa do limiar (corta teclado e ruído entre falas). */
  micGate: boolean;
  /** Limiar automático: acompanha o ruído de fundo do ambiente. */
  micGateAuto: boolean;
  /** Limiar manual, em dB (de -80 a -10). */
  micGateDb: number;
  /** Quando avisar no Windows: todas as mensagens, só menções ou nunca. */
  notifyMode: NotifyMode;
  notifySound: boolean;
  /** Sons de entrar, sair, mutar e ensurdecer na chamada. */
  callSounds: boolean;
  /** Volume dos sons do app, de 0 a 1. */
  soundVolume: number;
  /** A pessoa fechou o aviso "ativar notificações" sem ativar. */
  notifyPromptDismissed: boolean;
  /** Emojis usados por último nas reações (o mais recente primeiro). */
  recentEmojis: string[];
  /** Painel de chat aberto ao lado da chamada. */
  voiceChatOpen: boolean;
  /** Avisar quando alguém entrar num canal de voz (opcional; desligado por padrão). */
  notifyVoiceJoin: boolean;
  /** Ouvir os sons da mesa de sons que os amigos tocam na chamada. */
  soundboardEnabled: boolean;
  /** Volume da mesa de sons, de 0 a 1. */
  soundboardVolume: number;
  /** Admins: último erro do painel já visto neste aparelho. */
  errorsSeenId: number;
  set(patch: Partial<Omit<Settings, "set" | "setUserVolume" | "setStreamVolume">>): void;
  setUserVolume(userId: string, volume: number): void;
  setStreamVolume(userId: string, volume: number): void;
}

export type NotifyMode = "all" | "mentions" | "none";
export type NoiseMode = "ai" | "browser" | "off";

const RECENT_EMOJIS_MAX = 8;

/** Coloca o emoji na frente da lista de recentes (sem repetir). */
export function rememberEmoji(emoji: string) {
  const recent = useSettings.getState().recentEmojis.filter((e) => e !== emoji);
  useSettings.getState().set({ recentEmojis: [emoji, ...recent].slice(0, RECENT_EMOJIS_MAX) });
}

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      micDeviceId: null,
      speakerDeviceId: null,
      noiseMode: "ai",
      echoCancellation: true,
      pttEnabled: false,
      pttKey: "Backquote",
      userVolumes: {},
      streamVolumes: {},
      captionsView: false,
      transcribe: false,
      captionsLang: "pt-BR",
      watchVolume: 60,
      screenQuality: DEFAULT_SCREEN_QUALITY,
      screenAudio: true,
      micGate: true,
      micGateAuto: true,
      micGateDb: -50,
      notifyMode: "all",
      notifySound: true,
      callSounds: true,
      soundVolume: 0.6,
      notifyPromptDismissed: false,
      recentEmojis: [],
      voiceChatOpen: true,
      notifyVoiceJoin: false,
      soundboardEnabled: true,
      soundboardVolume: 0.7,
      errorsSeenId: 0,
      set: (patch) => set(patch),
      setUserVolume: (userId, volume) =>
        set((s) => ({ userVolumes: { ...s.userVolumes, [userId]: Math.min(2, Math.max(0, volume)) } })),
      setStreamVolume: (userId, volume) =>
        set((s) => ({ streamVolumes: { ...s.streamVolumes, [userId]: Math.min(2, Math.max(0, volume)) } })),
    }),
    { name: "resenha-settings", version: 1 },
  ),
);

/** Nome legível de uma tecla a partir do KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const names: Record<string, string> = {
    Backquote: "` (crase)",
    Space: "Espaço",
    CapsLock: "Caps Lock",
    ShiftLeft: "Shift esquerdo",
    ShiftRight: "Shift direito",
    ControlLeft: "Ctrl esquerdo",
    ControlRight: "Ctrl direito",
    AltLeft: "Alt esquerdo",
    AltRight: "Alt direito",
    Tab: "Tab",
  };
  return names[code] ?? code;
}
