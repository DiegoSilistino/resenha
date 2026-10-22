import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { LIVEKIT_ROOM_PREFIX } from "@resenha/shared";
import type { Config } from "../config.ts";
import type { UserRecord } from "../store.ts";

export const roomName = (channelId: string) => `${LIVEKIT_ROOM_PREFIX}${channelId}`;

export interface VoiceGateway {
  createToken(user: UserRecord, channelId: string): Promise<string>;
  /** URL que o navegador usa; sem configuração explícita, é o próprio domínio do app. */
  publicUrl(requestProtocol: string, requestHost: string): string;
  /** Tira alguém da sala (conta desativada, canal apagado). Falhas são ignoradas. */
  kick(userId: string, channelId: string): Promise<void>;
}

export class LiveKitGateway implements VoiceGateway {
  private readonly rooms: RoomServiceClient;

  constructor(private readonly cfg: Config["livekit"]) {
    this.rooms = new RoomServiceClient(cfg.apiUrl, cfg.apiKey, cfg.apiSecret);
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
}
