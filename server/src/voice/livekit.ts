import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { LIVEKIT_ROOM_PREFIX } from "@resenha/shared";
import type { Config } from "../config.ts";
import type { UserRecord } from "../store.ts";

export const roomName = (channelId: string) => `${LIVEKIT_ROOM_PREFIX}${channelId}`;

/** Resultado da checagem do servidor de voz, feita antes de liberar a entrada num canal. */
export type VoiceHealth =
  | { ok: true }
  | { ok: false; problem: "unreachable" | "unauthorized" | "error"; detail: string };

export interface VoiceGateway {
  createToken(user: UserRecord, channelId: string): Promise<string>;
  /** URL que o navegador usa; sem configuração explícita, é o próprio domínio do app. */
  publicUrl(requestProtocol: string, requestHost: string): string;
  /** Tira alguém da sala (conta desativada, canal apagado). Falhas são ignoradas. */
  kick(userId: string, channelId: string): Promise<void>;
  /** O LiveKit responde e aceita as nossas credenciais? */
  check(): Promise<VoiceHealth>;
}

/** Uma checagem bem-sucedida vale por alguns segundos (várias pessoas entrando juntas = 1 checagem). */
const HEALTHY_CACHE_MS = 15_000;

export class LiveKitGateway implements VoiceGateway {
  private readonly rooms: RoomServiceClient;
  private readonly probe: RoomServiceClient;
  private healthyUntil = 0;

  constructor(private readonly cfg: Config["livekit"]) {
    this.rooms = new RoomServiceClient(cfg.apiUrl, cfg.apiKey, cfg.apiSecret);
    // Sem failover e com prazo curto: a checagem precisa responder rápido, mesmo com o LiveKit fora.
    this.probe = new RoomServiceClient(cfg.apiUrl, cfg.apiKey, cfg.apiSecret, {
      requestTimeout: 3,
      failover: false,
    });
  }

  async createToken(user: UserRecord, channelId: string): Promise<string> {
    const at = new AccessToken(this.cfg.apiKey, this.cfg.apiSecret, {
      identity: user.id,
      name: user.displayName,
      metadata: JSON.stringify({ avatarColor: user.avatarColor }),
      // Só vale para entrar; durante a chamada o LiveKit renova o token sozinho.
      ttl: "10m",
    });
    at.addGrant({
      roomJoin: true,
      room: roomName(channelId),
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: false,
    });
    return at.toJwt();
  }

  publicUrl(requestProtocol: string, requestHost: string): string {
    if (this.cfg.publicUrl) return this.cfg.publicUrl;
    return `${requestProtocol === "https" ? "wss" : "ws"}://${requestHost}`;
  }

  async kick(userId: string, channelId: string): Promise<void> {
    try {
      await this.rooms.removeParticipant(roomName(channelId), userId);
    } catch {
      // a pessoa já pode ter saído; nada a fazer
    }
  }

  async check(): Promise<VoiceHealth> {
    if (Date.now() < this.healthyUntil) return { ok: true };
    try {
      await this.probe.listRooms();
      this.healthyUntil = Date.now() + HEALTHY_CACHE_MS;
      return { ok: true };
    } catch (err) {
      this.healthyUntil = 0;
      return classifyProbeError(err, this.cfg.apiUrl);
    }
  }
}

/** Traduz a falha da chamada à API do LiveKit em um problema que dá para explicar. */
export function classifyProbeError(err: unknown, apiUrl: string): VoiceHealth & { ok: false } {
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number") {
    if (status === 401 || status === 403) {
      return { ok: false, problem: "unauthorized", detail: `${apiUrl} respondeu ${status}` };
    }
    return { ok: false, problem: "error", detail: `${apiUrl} respondeu ${status}` };
  }
  // Sem resposta HTTP: recusado, nome não resolvido, tempo esgotado…
  const cause = (err as { cause?: { code?: string } })?.cause?.code;
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, problem: "unreachable", detail: `${apiUrl}: ${cause ?? message}` };
}
