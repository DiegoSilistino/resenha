import { create } from "zustand";
import type { WatchState } from "@resenha/shared";

/**
 * O que é só SEU no Assistir juntos (fica no navegador, não vai para o servidor):
 * - esconder o player da sessão atual sem atrapalhar quem continua assistindo;
 * - abrir o painel para colocar o primeiro vídeo.
 */
interface WatchUiState {
  /** canal -> sessão que você escondeu */
  dismissed: Record<string, string>;
  /** canal -> painel aberto sem nada tocando */
  panelOpen: Record<string, true>;
  hide(channelId: string, sessionId: string): void;
  show(channelId: string): void;
  setPanelOpen(channelId: string, open: boolean): void;
}

export const useWatchUi = create<WatchUiState>()((set) => ({
  dismissed: {},
  panelOpen: {},
  hide: (channelId, sessionId) =>
    set((s) => ({ dismissed: { ...s.dismissed, [channelId]: sessionId }, panelOpen: without(s.panelOpen, channelId) })),
  show: (channelId) => set((s) => ({ dismissed: without(s.dismissed, channelId) })),
  setPanelOpen: (channelId, open) =>
    set((s) => ({ panelOpen: open ? { ...s.panelOpen, [channelId]: true } : without(s.panelOpen, channelId) })),
}));

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const copy = { ...record };
  delete copy[key];
  return copy;
}

export interface WatchVisibility {
  /** Há uma sessão rolando no canal (para todos). */
  active: boolean;
  /** O player aparece para VOCÊ. */
  playerVisible: boolean;
  /** A área do Assistir juntos (player e/ou fila) aparece para você. */
  areaVisible: boolean;
  /** Identidade da sessão atual (null sem sessão). */
  sessionId: string | null;
}

/** Regra pura (testável) de quando mostrar o player e a área do Assistir juntos. */
export function watchVisibility(
  state: WatchState | undefined,
  dismissedSession: string | undefined,
  panelOpen: boolean,
): WatchVisibility {
  // `?? current.id`: compatível com um servidor antigo que ainda não manda sessionId.
  const sessionId = state?.current ? (state.sessionId ?? state.current.id) : null;
  const active = sessionId !== null;
  const playerVisible = active && dismissedSession !== sessionId;
  return { active, playerVisible, areaVisible: playerVisible || (!active && panelOpen), sessionId };
}

export function useWatchVisibility(channelId: string | null, state: WatchState | undefined): WatchVisibility {
  const dismissed = useWatchUi((s) => (channelId ? s.dismissed[channelId] : undefined));
  const panelOpen = useWatchUi((s) => (channelId ? !!s.panelOpen[channelId] : false));
  return watchVisibility(state, dismissed, panelOpen);
}
