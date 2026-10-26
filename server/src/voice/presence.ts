import type { VoiceMember } from "@resenha/shared";
import type { Hub } from "../realtime/hub.ts";

interface Entry extends VoiceMember {
  channelId: string;
  connId: string;
}

/**
 * Quem está em qual canal de voz, para todos verem na barra lateral.
 *
 * O cliente informa quando conectou/desconectou no LiveKit. Se o WebSocket cai
 * (aba fechada, navegador travou), a entrada é removida junto. Cada usuário fica
 * em no máximo um canal; entrar por outra aba substitui a anterior.
 */
export class VoicePresence {
  private readonly byUser = new Map<string, Entry>();
  private readonly emptyListeners: ((channelId: string) => void)[] = [];

  constructor(private readonly hub: Hub) {}

  onChannelEmpty(fn: (channelId: string) => void) {
    this.emptyListeners.push(fn);
  }

  join(userId: string, connId: string, channelId: string): void {
    const previous = this.byUser.get(userId);
    this.byUser.set(userId, {
      userId,
      connId,
      channelId,
      muted: false,
      deafened: false,
      streaming: false,
      video: false,
      joinedAt: previous?.channelId === channelId ? previous.joinedAt : Date.now(),
    });
    if (previous && previous.channelId !== channelId) this.channelChanged(previous.channelId);
    this.channelChanged(channelId);
  }

  /** Sai do canal. Com `connId`, só sai se a entrada pertencer àquela conexão. */
  leave(userId: string, connId?: string): void {
    const entry = this.byUser.get(userId);
    if (!entry || (connId !== undefined && entry.connId !== connId)) return;
    this.byUser.delete(userId);
    this.channelChanged(entry.channelId);
  }

  setFlags(
    userId: string,
    connId: string,
    flags: Pick<VoiceMember, "muted" | "deafened" | "streaming" | "video">,
  ): void {
    const entry = this.byUser.get(userId);
    if (!entry || entry.connId !== connId) return;
    if (
      entry.muted === flags.muted &&
      entry.deafened === flags.deafened &&
      entry.streaming === flags.streaming &&
      entry.video === flags.video
    ) {
      return;
    }
    Object.assign(entry, flags);
    this.channelChanged(entry.channelId);
  }

  channelOf(userId: string): string | null {
    return this.byUser.get(userId)?.channelId ?? null;
  }

  isIn(userId: string, channelId: string): boolean {
    return this.byUser.get(userId)?.channelId === channelId;
  }

  /** Conexões (abas) que estão de fato naquela chamada. */
  connectionsIn(channelId: string): string[] {
    return [...this.byUser.values()].filter((e) => e.channelId === channelId).map((e) => e.connId);
  }

  members(channelId: string): VoiceMember[] {
    return [...this.byUser.values()]
      .filter((e) => e.channelId === channelId)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map(({ channelId: _c, connId: _k, ...m }) => m);
  }

  /** Remove todos de um canal (canal apagado). Devolve quem estava lá. */
  clearChannel(channelId: string): string[] {
    const removed: string[] = [];
    for (const [userId, e] of this.byUser) {
      if (e.channelId === channelId) {
        this.byUser.delete(userId);
        removed.push(userId);
      }
    }
    if (removed.length) this.channelChanged(channelId);
    return removed;
  }

  snapshot(): Record<string, VoiceMember[]> {
    const channels = new Set([...this.byUser.values()].map((e) => e.channelId));
    return Object.fromEntries([...channels].map((c) => [c, this.members(c)]));
  }

  private channelChanged(channelId: string): void {
    const members = this.members(channelId);
    this.hub.broadcast({ type: "voice.channel", channelId, members });
    if (members.length === 0) for (const fn of this.emptyListeners) fn(channelId);
  }
}
