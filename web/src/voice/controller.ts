/**
 * Fachada da voz: o que o resto do app chama. Leve de propósito: o motor da chamada
 * (room.ts, com o LiveKit) só é baixado ao entrar numa chamada, ou em segundo plano
 * depois que a página já abriu (preloadVoice).
 */
import type { Participant, Room } from "livekit-client";
import { loadChunk } from "../lib/chunks.ts";
import { playSound } from "../lib/sounds.ts";
import { toast } from "../state/toasts.ts";
import { useSettings } from "../state/settings.ts";
import type { GateConfig } from "./gate/engine.ts";
import type { MicChainConfig } from "./gate/processor.ts";
import type { ScreenQualityId } from "./screenQuality.ts";
import { useVoice } from "./state.ts";

export { useVoice } from "./state.ts";
export type { Caption, VoiceStatus } from "./state.ts";

type RoomModule = typeof import("./room.ts");
let engine: RoomModule | null = null;
let loading: Promise<RoomModule> | null = null;

function loadEngine(): Promise<RoomModule> {
  loading ??= loadChunk(() => import("./room.ts")).then((m) => (engine = m));
  loading.catch(() => {
    loading = null; // falhou (rede): tenta de novo no próximo clique
  });
  return loading;
}

/** Baixa o motor da voz sem atrapalhar a abertura da página. */
export function preloadVoice(): void {
  void loadEngine().catch(() => undefined);
}

// ---------------------------------------------------------------- preferências do microfone

export function micOptions() {
  const s = useSettings.getState();
  return {
    ...(s.micDeviceId ? { deviceId: s.micDeviceId } : {}),
    echoCancellation: s.echoCancellation,
    // Com a IA, a redução do navegador fica desligada: as duas juntas pioram a voz.
    noiseSuppression: s.noiseMode === "browser",
    autoGainControl: true,
  };
}

/** Preferência de sensibilidade em vigor. Com push-to-talk, a tecla já decide: o portão fica aberto. */
export function gateConfig(): GateConfig {
  const s = useSettings.getState();
  return { enabled: s.micGate && !s.pttEnabled, auto: s.micGateAuto, thresholdDb: s.micGateDb };
}

export function micChainConfig(): MicChainConfig {
  return { ai: useSettings.getState().noiseMode === "ai", gate: gateConfig() };
}

export async function listDevices(kind: MediaDeviceKind): Promise<MediaDeviceInfo[]> {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === kind);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- chamada

export async function joinVoice(channelId: string): Promise<void> {
  let m = engine;
  if (!m) {
    try {
      m = await loadEngine();
    } catch {
      toast.error("Não consegui carregar a parte de voz do app. Confira sua internet e tente de novo.");
      return;
    }
  }
  await m.joinVoice(channelId);
}

/** `sound: false` ao trocar de canal (só toca o som de entrar no novo). */
export async function leaveVoice(opts?: { sound?: boolean }): Promise<void> {
  await engine?.leaveVoice(opts);
}

export const currentRoom = (): Room | null => engine?.currentRoom() ?? null;

/** Participantes da sala atual (você primeiro). Use junto com `useVoice(s => s.version)`. */
export const roomParticipants = (): Participant[] => engine?.roomParticipants() ?? [];

export function toggleMute() {
  const v = useVoice.getState();
  // Como no Discord: ligar o microfone enquanto ensurdecido também volta a ouvir.
  if (v.deafened) {
    useVoice.setState({ deafened: false, muted: false });
    playSound("undeafen");
  } else {
    useVoice.setState({ muted: !v.muted });
    playSound(v.muted ? "unmute" : "mute");
  }
  engine?.afterLocalAudioChange();
}

export function toggleDeafen() {
  const was = useVoice.getState().deafened;
  useVoice.setState({ deafened: !was });
  playSound(was ? "undeafen" : "deafen");
  engine?.afterLocalAudioChange();
}

/** Silencia ou volta o som da tela de uma pessoa, sem perder o volume escolhido. */
export function toggleStreamMuted(userId: string) {
  useVoice.setState((s) => {
    const streamMuted = { ...s.streamMuted };
    if (streamMuted[userId]) delete streamMuted[userId];
    else streamMuted[userId] = true;
    return { streamMuted };
  });
  engine?.applyVolumes();
}

/** Abre ou fecha a tela de alguém. Abrir já fixa no quadro grande, como no Discord. */
export function setWatching(userId: string, on: boolean) {
  useVoice.setState((s) => {
    const watching = { ...s.watching };
    if (on) watching[userId] = true;
    else delete watching[userId];
    return { watching, focused: on ? userId : s.focused === userId ? null : s.focused };
  });
  engine?.applyVolumes(); // o som da tela só toca para quem está assistindo
}

/** Fixa uma tela no quadro grande (null volta para a grade). */
export function setFocused(userId: string | null) {
  useVoice.setState({ focused: userId });
}

/** Alguns navegadores bloqueiam áudio até um clique: chamado pelo botão "Ativar som". */
export async function unlockAudio(): Promise<void> {
  await engine?.unlockAudio();
}

/** Botão de tela: se já transmite, para; senão abre a escolha de qualidade. */
export function toggleScreenShare(): void {
  engine?.toggleScreenShare();
}

/** Começa a transmitir. Chame direto do clique (o navegador exige um gesto para abrir a escolha de tela). */
export async function startScreenShare(qualityId: ScreenQualityId, withAudio: boolean): Promise<void> {
  await engine?.startScreenShare(qualityId, withAudio);
}

export async function stopScreenShare(): Promise<void> {
  await engine?.stopScreenShare();
}

export async function toggleCamera(): Promise<void> {
  await engine?.toggleCamera();
}
