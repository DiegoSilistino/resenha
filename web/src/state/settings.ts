import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_SCREEN_QUALITY, type ScreenQualityId } from "../voice/screenQuality.ts";

/** Preferências deste aparelho (ficam no navegador, não no servidor). */
export interface Settings {
  micDeviceId: string | null;
  speakerDeviceId: string | null;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  pttEnabled: boolean;
  /** KeyboardEvent.code da tecla do push-to-talk */
  pttKey: string;
  /** volume por pessoa, 0 a 2 (200%) */
  userVolumes: Record<string, number>;
  captionsView: boolean;
  /** Consentimento explícito: a fala vai para o reconhecimento de voz do navegador. */
  transcribe: boolean;
  captionsLang: string;
  watchVolume: number;
  /** Último perfil de qualidade usado para transmitir a tela. */
  screenQuality: ScreenQualityId;
  /** Transmitir também o som do computador junto com a tela. */
  screenAudio: boolean;
  set(patch: Partial<Omit<Settings, "set" | "setUserVolume">>): void;
  setUserVolume(userId: string, volume: number): void;
}

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      micDeviceId: null,
      speakerDeviceId: null,
      noiseSuppression: true,
      echoCancellation: true,
      pttEnabled: false,
      pttKey: "Backquote",
      userVolumes: {},
      captionsView: false,
      transcribe: false,
      captionsLang: "pt-BR",
      watchVolume: 60,
      screenQuality: DEFAULT_SCREEN_QUALITY,
      screenAudio: true,
      set: (patch) => set(patch),
      setUserVolume: (userId, volume) =>
        set((s) => ({ userVolumes: { ...s.userVolumes, [userId]: Math.min(2, Math.max(0, volume)) } })),
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
