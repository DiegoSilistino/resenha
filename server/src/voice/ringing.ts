import type { CallRing } from "@resenha/shared";
import type { Hub } from "../realtime/hub.ts";

/** Quanto tempo toca antes de virar "não atendeu". */
export const RING_MS = 30_000;

interface Ring {
  callerId: string;
  pending: Set<string>;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Toque da chamada na conversa privada, como no Discord: quem começa a chamada faz tocar para os outros
 * membros até cada um atender (entrar), recusar ou dar o tempo. Fica no servidor para que atender ou
 * recusar num aparelho pare de tocar nos outros. Só em memória: reiniciar o servidor encerra os toques.
 */
export class CallRinger {
  private readonly rings = new Map<string, Ring>();
  /** Membros da conversa (quem fica sabendo do toque). */
  audienceOf: (channelId: string) => string[] | null = () => [];

  constructor(private readonly hub: Hub) {}

  start(channelId: string, callerId: string): void {
    this.end(channelId);
    const pending = new Set(this.members(channelId).filter((id) => id !== callerId));
    if (pending.size === 0) return;
    const timer = setTimeout(() => this.giveUp(channelId), RING_MS);
    timer.unref?.();
    this.rings.set(channelId, { callerId, pending, timer });
    this.publish(channelId);
  }

  /** Entrou na chamada: atendeu. */
  answered(channelId: string, userId: string): void {
    this.drop(channelId, userId);
  }

  decline(channelId: string, userId: string): void {
    if (this.drop(channelId, userId)) this.declined(channelId, userId, "recusou");
  }

  /** Chamada acabou (ficou vazia): para de tocar para todo mundo. */
  end(channelId: string): void {
    const ring = this.rings.get(channelId);
    if (!ring) return;
    clearTimeout(ring.timer);
    this.rings.delete(channelId);
    this.hub.publish(this.members(channelId), { type: "call.ring", channelId, ring: null });
  }

  snapshot(): Record<string, CallRing> {
    return Object.fromEntries([...this.rings].map(([channelId, r]) => [channelId, { callerId: r.callerId, pending: [...r.pending] }]));
  }

  private drop(channelId: string, userId: string): boolean {
    const ring = this.rings.get(channelId);
    if (!ring?.pending.delete(userId)) return false;
    if (ring.pending.size === 0) this.end(channelId);
    else this.publish(channelId);
    return true;
  }

  private giveUp(channelId: string): void {
    const ring = this.rings.get(channelId);
    if (!ring) return;
    for (const userId of ring.pending) this.declined(channelId, userId, "nao-atendeu");
    this.end(channelId);
  }

  private declined(channelId: string, userId: string, reason: "recusou" | "nao-atendeu"): void {
    this.hub.publish(this.members(channelId), { type: "call.declined", channelId, userId, reason });
  }

  private publish(channelId: string): void {
    const ring = this.rings.get(channelId)!;
    this.hub.publish(this.members(channelId), { type: "call.ring", channelId, ring: { callerId: ring.callerId, pending: [...ring.pending] } });
  }

  // na dúvida (canal sumiu, banco fechando), ninguém: nunca todo mundo
  private members(channelId: string): string[] {
    return this.audienceOf(channelId) ?? [];
  }
}
