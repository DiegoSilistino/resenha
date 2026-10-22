import { randomUUID } from "node:crypto";
import {
  createWatchState,
  parseYouTubeVideoId,
  reduceWatch,
  type WatchAction,
  type WatchClientAction,
  type WatchState,
} from "@resenha/shared";
import type { Hub } from "../realtime/hub.ts";
import type { TitleFetcher } from "./oembed.ts";

export class WatchError extends Error {}

/**
 * Estado do "Assistir juntos" por canal de voz, em memória.
 * (Reiniciar o servidor esvazia as filas: aceitável para um grupo pequeno.)
 */
export class WatchService {
  private readonly states = new Map<string, WatchState>();

  constructor(
    private readonly hub: Hub,
    private readonly fetchTitle: TitleFetcher,
    private readonly now: () => number = Date.now,
  ) {}

  get(channelId: string): WatchState {
    return this.states.get(channelId) ?? createWatchState(channelId);
  }

  /** Só canais com algo tocando ou na fila (o resto é o estado vazio padrão). */
  snapshot(): Record<string, WatchState> {
    return Object.fromEntries(
      [...this.states].filter(([, s]) => s.current || s.queue.length > 0),
    );
  }

  async handle(userId: string, channelId: string, action: WatchClientAction): Promise<void> {
    if (action.kind === "add") {
      const videoId = parseYouTubeVideoId(action.url);
      if (!videoId) throw new WatchError("Esse link não parece ser de um vídeo do YouTube.");
      const lookup = await this.fetchTitle(videoId);
      if (!lookup.ok) {
        throw new WatchError(
          lookup.reason === "not_embeddable"
            ? "O dono desse vídeo não permite reproduzir fora do YouTube."
            : "Vídeo não encontrado (pode ser privado ou ter sido removido).",
        );
      }
      this.apply(channelId, {
        kind: "add",
        item: {
          id: randomUUID(),
          videoId,
          title: lookup.title ?? "Vídeo do YouTube",
          addedBy: userId,
          addedAt: this.now(),
        },
      });
      return;
    }
    this.apply(channelId, action);
  }

  /** Quando o último sai da sala, pausa: ninguém volta e encontra o vídeo 40 minutos à frente. */
  pauseIfPlaying(channelId: string): void {
    const s = this.states.get(channelId);
    if (s?.playing) this.apply(channelId, { kind: "pause" });
  }

  removeChannel(channelId: string): void {
    this.states.delete(channelId);
  }

  private apply(channelId: string, action: WatchAction): void {
    const prev = this.get(channelId);
    const next = reduceWatch(prev, action, this.now());
    if (next === prev) return;
    this.states.set(channelId, next);
    this.hub.broadcast({ type: "watch.state", state: next });
  }
}
