import { LIMITS } from "./constants.ts";
import type { WatchItem, WatchState } from "./types.ts";

/** Ações já resolvidas que a máquina de estados entende (o servidor resolve links e títulos antes). */
export type WatchAction =
  | { kind: "add"; item: WatchItem }
  | { kind: "remove"; itemId: string }
  | { kind: "skip" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "seek"; seconds: number }
  /** Um cliente avisou que o vídeo atual acabou. Idempotente: só avança se `itemId` ainda for o atual. */
  | { kind: "ended"; itemId: string }
  | { kind: "clear" };

export function createWatchState(channelId: string): WatchState {
  return {
    channelId,
    sessionId: null,
    current: null,
    queue: [],
    playing: false,
    startedAt: 0,
    pausedPosition: 0,
    version: 0,
  };
}

/** Posição (segundos) do vídeo atual num instante do relógio do servidor. */
export function watchPositionAt(state: WatchState, serverNowMs: number): number {
  if (!state.current) return 0;
  if (!state.playing) return state.pausedPosition;
  return Math.max(0, (serverNowMs - state.startedAt) / 1000);
}

/**
 * Aplica uma ação e devolve um NOVO estado (o original nunca é alterado).
 * Se a ação não muda nada, devolve o mesmo objeto, então `next === prev` indica "sem mudança".
 */
export function reduceWatch(state: WatchState, action: WatchAction, nowMs: number): WatchState {
  const next = applyAction(state, action, nowMs);
  return next === state ? state : { ...next, version: state.version + 1 };
}

function applyAction(s: WatchState, action: WatchAction, now: number): WatchState {
  switch (action.kind) {
    case "add": {
      // Sem nada tocando: começa uma sessão nova, identificada pelo primeiro vídeo.
      if (!s.current) return { ...playItem(s, action.item, s.queue, now), sessionId: action.item.id };
      if (s.queue.length >= LIMITS.watchQueueMax) return s;
      return { ...s, queue: [...s.queue, action.item] };
    }
    case "remove": {
      if (s.current?.id === action.itemId) return advance(s, now);
      const queue = s.queue.filter((i) => i.id !== action.itemId);
      return queue.length === s.queue.length ? s : { ...s, queue };
    }
    case "skip":
      return s.current ? advance(s, now) : s;
    case "ended":
      return s.current?.id === action.itemId ? advance(s, now) : s;
    case "pause":
      if (!s.current || !s.playing) return s;
      return { ...s, playing: false, pausedPosition: watchPositionAt(s, now) };
    case "resume":
      if (!s.current || s.playing) return s;
      return { ...s, playing: true, startedAt: now - s.pausedPosition * 1000 };
    case "seek": {
      if (!s.current || !Number.isFinite(action.seconds)) return s;
      const seconds = Math.max(0, action.seconds);
      return s.playing
        ? { ...s, startedAt: now - seconds * 1000 }
        : { ...s, pausedPosition: seconds };
    }
    case "clear":
      if (!s.current && s.queue.length === 0) return s;
      return endSession(s);
  }
}

function advance(s: WatchState, now: number): WatchState {
  const [nextItem, ...rest] = s.queue;
  if (!nextItem) return endSession(s);
  return playItem(s, nextItem, rest, now); // mesma sessão
}

function endSession(s: WatchState): WatchState {
  return { ...s, sessionId: null, current: null, queue: [], playing: false, startedAt: 0, pausedPosition: 0 };
}

function playItem(s: WatchState, item: WatchItem, queue: WatchItem[], now: number): WatchState {
  return { ...s, current: item, queue, playing: true, startedAt: now, pausedPosition: 0 };
}
