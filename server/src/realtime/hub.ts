import type { WebSocket } from "ws";
import type { ServerEvent } from "@resenha/shared";

export interface Connection {
  id: string;
  userId: string;
  tokenHash: string;
  socket: WebSocket;
  alive: boolean;
  lastTypingAt: number;
}

/**
 * Registro das conexões WebSocket abertas e envio de eventos.
 * Um usuário pode ter várias conexões (abas, celular); ele está "online" se tiver pelo menos uma.
 */
export class Hub {
  private readonly conns = new Map<string, Connection>();
  private readonly onPresence: ((userId: string, online: boolean) => void)[] = [];
  /** Quem escolheu "Invisível": conectado, mas os outros não o veem online. */
  private readonly hidden = new Set<string>();

  onPresenceChange(fn: (userId: string, online: boolean) => void) {
    this.onPresence.push(fn);
  }

  add(conn: Connection): void {
    const wasOnline = this.isOnline(conn.userId);
    this.conns.set(conn.id, conn);
    if (!wasOnline) {
      if (!this.hidden.has(conn.userId)) this.broadcast({ type: "presence", userId: conn.userId, online: true }, conn.id);
      for (const fn of this.onPresence) fn(conn.userId, true);
    }
  }

  remove(connId: string): Connection | undefined {
    const conn = this.conns.get(connId);
    if (!conn) return undefined;
    this.conns.delete(connId);
    if (!this.isOnline(conn.userId)) {
      if (!this.hidden.has(conn.userId)) this.broadcast({ type: "presence", userId: conn.userId, online: false });
      for (const fn of this.onPresence) fn(conn.userId, false);
    }
    return conn;
  }

  /** Liga/desliga o "Invisível"; se a pessoa está conectada, os outros a veem sair ou voltar. */
  setHidden(userId: string, hidden: boolean): void {
    if (this.hidden.has(userId) === hidden) return;
    if (hidden) this.hidden.add(userId);
    else this.hidden.delete(userId);
    if (this.isOnline(userId)) this.broadcast({ type: "presence", userId, online: !hidden });
  }

  get(connId: string): Connection | undefined {
    return this.conns.get(connId);
  }

  isOnline(userId: string): boolean {
    for (const c of this.conns.values()) if (c.userId === userId) return true;
    return false;
  }

  /** Quem aparece online para os outros (invisíveis ficam de fora). */
  onlineUserIds(): string[] {
    return [...new Set([...this.conns.values()].map((c) => c.userId))].filter((id) => !this.hidden.has(id));
  }

  send(conn: Connection, event: ServerEvent): void {
    if (conn.socket.readyState === conn.socket.OPEN) conn.socket.send(JSON.stringify(event));
  }

  broadcast(event: ServerEvent, exceptConnId?: string): void {
    const data = JSON.stringify(event);
    for (const c of this.conns.values()) {
      if (c.id !== exceptConnId && c.socket.readyState === c.socket.OPEN) c.socket.send(data);
    }
  }

  sendToUser(userId: string, event: ServerEvent): void {
    for (const c of this.conns.values()) if (c.userId === userId) this.send(c, event);
  }

  sendToConnection(connId: string, event: ServerEvent): void {
    const c = this.conns.get(connId);
    if (c) this.send(c, event);
  }

  /** Só para quem passar no filtro (ex.: administradores). */
  sendWhere(predicate: (userId: string) => boolean, event: ServerEvent): void {
    const data = JSON.stringify(event);
    for (const c of this.conns.values()) {
      if (predicate(c.userId) && c.socket.readyState === c.socket.OPEN) c.socket.send(data);
    }
  }

  /** Fecha conexões que satisfazem o filtro (ex.: sessão revogada, conta desativada). */
  closeWhere(predicate: (c: Connection) => boolean, code: number, reason: string): void {
    for (const c of [...this.conns.values()]) {
      if (predicate(c)) c.socket.close(code, reason);
    }
  }

  /** Marca e varre conexões mortas (sem resposta ao ping), para a presença não ficar presa. */
  sweep(): void {
    for (const c of this.conns.values()) {
      if (!c.alive) {
        c.socket.terminate();
        continue;
      }
      c.alive = false;
      c.socket.ping();
    }
  }

  closeAll(code: number, reason: string): void {
    for (const c of this.conns.values()) c.socket.close(code, reason);
  }
}
