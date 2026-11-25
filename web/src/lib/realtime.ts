import {
  ClockSync,
  WS_CLOSE_SESSION_REVOKED,
  WS_CLOSE_UNAUTHORIZED,
  type ClientMessage,
  type ServerEvent,
} from "@resenha/shared";
import { useApp } from "../state/app.ts";
import { useSettings } from "../state/settings.ts";
import { toast } from "../state/toasts.ts";
import { onCallDeclined, onNewMessage, onRing, onVoiceMembers } from "./notify.ts";

/** Relógio do servidor estimado, usado para sincronizar o "Assistir juntos". */
export const clock = new ClockSync();

type Listener = () => void;

/** Versão do site que esta página carregou (vem no primeiro hello). */
let loadedBuild: string | null = null;
/** Para mostrar em Configurações → Conta (null em desenvolvimento). */
export const loadedBuildId = () => loadedBuild;

/**
 * Conexão WebSocket com reconexão automática (backoff exponencial com jitter).
 * O primeiro evento de cada conexão é sempre "hello", que reidrata todo o estado.
 */
class RealtimeClient {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;
  private readonly helloListeners = new Set<Listener>();
  private readonly eventListeners = new Set<(event: ServerEvent) => void>();

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close(1000, "logout");
    this.ws = null;
  }

  /** Avisa a cada (re)conexão concluída: a voz usa isso para reanunciar em que canal está. */
  onHello(fn: Listener): () => void {
    this.helloListeners.add(fn);
    return () => this.helloListeners.delete(fn);
  }

  /** Eventos depois de aplicados ao estado (módulos que reagem a algo, como a mesa de sons). */
  onEvent(fn: (event: ServerEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  /** Se estiver esperando para reconectar, tenta agora (rede voltou, aba voltou ao foco). */
  reconnectNow(): void {
    if (this.stopped || this.ws || !this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.open();
  }

  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private open(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    useApp.getState().setConnection("connecting");

    ws.onmessage = (msg) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(String(msg.data)) as ServerEvent;
      } catch {
        return;
      }
      this.handle(event);
    };

    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      if (e.code === WS_CLOSE_SESSION_REVOKED || e.code === WS_CLOSE_UNAUTHORIZED) {
        this.stopped = true;
        useApp.getState().reset();
        if (e.code === WS_CLOSE_SESSION_REVOKED) toast.error("Sua sessão foi encerrada. Entre novamente.");
        return;
      }
      if (this.stopped) return;
      useApp.getState().setConnection("offline");
      this.scheduleReconnect();
    };
  }

  private handle(event: ServerEvent): void {
    switch (event.type) {
      case "hello": {
        this.attempt = 0;
        useApp.getState().applyEvent(event);
        // Painel de erros zerado ou banco restaurado: o "último visto" volta junto.
        const seen = useSettings.getState().errorsSeenId;
        if (event.latestErrorId !== undefined && event.latestErrorId < seen) {
          useSettings.getState().set({ errorsSeenId: event.latestErrorId });
        }
        if (event.latestFeedbackId !== undefined && event.latestFeedbackId < useSettings.getState().feedbackSeenId) {
          useSettings.getState().set({ feedbackSeenId: event.latestFeedbackId });
        }
        // Deploy: o servidor voltou com outra versão do site que a desta página (a primeira que viu)
        if (event.build) {
          loadedBuild ??= event.build;
          if (event.build !== loadedBuild) useApp.setState({ updateAvailable: true });
        }
        useApp.getState().setConnection("online");
        this.startPinging();
        for (const fn of this.helloListeners) fn();
        return;
      }
      case "pong":
        clock.addSample(event.t0, event.serverTime, Date.now());
        return;
      case "notice":
        if (event.level === "error") toast.error(event.text);
        else toast.info(event.text);
        return;
      case "wallet":
        useApp.getState().applyEvent(event);
        if (event.daily) toast.info(`+${event.daily} moedas por aparecer hoje. Gaste na Loja (Configurações → Loja).`);
        return;
      case "user.notice":
        useApp.getState().applyEvent(event);
        toast.info(event.notice.text);
        return;
      case "call.ring":
        useApp.getState().applyEvent(event);
        onRing(event.channelId, event.ring);
        return;
      case "call.declined":
        onCallDeclined(event.channelId, event.userId, event.reason);
        return;
      default: {
        const prevVoice = event.type === "voice.channel" ? (useApp.getState().voice[event.channelId] ?? []) : null;
        useApp.getState().applyEvent(event);
        if (event.type === "message.create") onNewMessage(event.message);
        if (event.type === "voice.channel" && prevVoice) onVoiceMembers(event.channelId, prevVoice, event.members);
        for (const fn of this.eventListeners) fn(event);
      }
    }
  }

  private startPinging(): void {
    this.clearPing();
    const ping = () => this.send({ type: "ping", t0: Date.now() });
    // Algumas amostras rápidas no início para o relógio ficar preciso logo.
    for (let i = 0; i < 4; i++) setTimeout(ping, i * 250);
    this.pingTimer = setInterval(ping, 15_000);
  }

  private scheduleReconnect(): void {
    const delay = Math.min(30_000, 500 * 2 ** this.attempt) * (0.5 + Math.random() / 2);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private clearPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private clearTimers(): void {
    this.clearPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

export const realtime = new RealtimeClient();

// Rede voltou ou aba voltou ao primeiro plano: não espera o backoff terminar.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => realtime.reconnectNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") realtime.reconnectNow();
  });
}
