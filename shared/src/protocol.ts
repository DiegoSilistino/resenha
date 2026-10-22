/**
 * Contrato entre cliente e servidor.
 * - Schemas zod validam tudo que chega ao servidor (REST e WebSocket).
 * - `ServerEvent` descreve tudo que o servidor envia pelo WebSocket.
 */
import { z } from "zod";
import { AVATAR_COLORS, LIMITS, USERNAME_PATTERN } from "./constants.ts";
import type {
  Channel,
  Me,
  Message,
  PublicUser,
  VoiceMember,
  WatchState,
} from "./types.ts";

const id = z.string().min(1).max(64);

// ---------- REST ----------

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(LIMITS.usernameMin, `Mínimo de ${LIMITS.usernameMin} caracteres`)
  .max(LIMITS.usernameMax, `Máximo de ${LIMITS.usernameMax} caracteres`)
  .regex(USERNAME_PATTERN, "Use só letras minúsculas, números, ponto, hífen e _");

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Informe um nome")
  .max(LIMITS.displayNameMax, `Máximo de ${LIMITS.displayNameMax} caracteres`);

export const passwordSchema = z
  .string()
  .min(LIMITS.passwordMin, `A senha precisa de pelo menos ${LIMITS.passwordMin} caracteres`)
  .max(LIMITS.passwordMax);

export const loginBody = z.object({
  username: z.string().trim().toLowerCase().min(1).max(LIMITS.usernameMax),
  password: z.string().min(1).max(LIMITS.passwordMax),
});

export const registerBody = z.object({
  code: id,
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
});

export const updateMeBody = z
  .object({
    displayName: displayNameSchema.optional(),
    avatarColor: z.enum(AVATAR_COLORS).optional(),
  })
  .refine((b) => b.displayName !== undefined || b.avatarColor !== undefined, "Nada para alterar");

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(LIMITS.passwordMax),
  newPassword: passwordSchema,
});

export const createInviteBody = z.object({
  role: z.enum(["admin", "member"]).default("member"),
  maxUses: z.number().int().min(1).max(50).default(1),
  /** null = não expira */
  expiresInHours: z.number().int().min(1).max(24 * 90).nullable().default(72),
});

export const channelNameSchema = z
  .string()
  .trim()
  .min(1, "Informe um nome")
  .max(LIMITS.channelNameMax, `Máximo de ${LIMITS.channelNameMax} caracteres`);

export const createChannelBody = z.object({
  name: channelNameSchema,
  kind: z.enum(["text", "voice"]),
});

export const updateChannelBody = z
  .object({
    name: channelNameSchema.optional(),
    position: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((b) => b.name !== undefined || b.position !== undefined, "Nada para alterar");

export const createMessageBody = z
  .object({
    content: z.string().max(LIMITS.messageMax).default(""),
    attachmentIds: z.array(id).max(LIMITS.attachmentsPerMessage).default([]),
  })
  .refine((b) => b.content.trim().length > 0 || b.attachmentIds.length > 0, "Mensagem vazia");

export const editMessageBody = z.object({
  content: z.string().trim().min(1).max(LIMITS.messageMax),
});

export const listMessagesQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(LIMITS.messagesPageSize),
});

export const voiceTokenBody = z.object({ channelId: id });

export interface VoiceTokenResponse {
  url: string;
  token: string;
}

// ---------- WebSocket: cliente -> servidor ----------

export const watchClientAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add"), url: z.string().trim().min(1).max(500) }),
  z.object({ kind: z.literal("remove"), itemId: id }),
  z.object({ kind: z.literal("skip") }),
  z.object({ kind: z.literal("pause") }),
  z.object({ kind: z.literal("resume") }),
  z.object({ kind: z.literal("seek"), seconds: z.number().min(0).max(60 * 60 * 24) }),
  z.object({ kind: z.literal("ended"), itemId: id }),
  z.object({ kind: z.literal("clear") }),
]);
export type WatchClientAction = z.infer<typeof watchClientAction>;

export const clientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping"), t0: z.number() }),
  z.object({ type: z.literal("typing"), channelId: id }),
  z.object({ type: z.literal("voice.join"), channelId: id }),
  z.object({ type: z.literal("voice.leave") }),
  z.object({
    type: z.literal("voice.flags"),
    muted: z.boolean(),
    deafened: z.boolean(),
    streaming: z.boolean(),
    video: z.boolean(),
  }),
  z.object({ type: z.literal("watch"), channelId: id, action: watchClientAction }),
]);
export type ClientMessage = z.infer<typeof clientMessage>;

// ---------- WebSocket: servidor -> cliente ----------

export interface HelloEvent {
  type: "hello";
  me: Me;
  users: PublicUser[];
  channels: Channel[];
  online: string[];
  voice: Record<string, VoiceMember[]>;
  watch: Record<string, WatchState>;
  serverTime: number;
}

export type ServerEvent =
  | HelloEvent
  | { type: "pong"; t0: number; serverTime: number }
  | { type: "presence"; userId: string; online: boolean }
  | { type: "user.upsert"; user: PublicUser }
  | { type: "channel.upsert"; channel: Channel }
  | { type: "channel.remove"; channelId: string }
  | { type: "message.create"; message: Message }
  | { type: "message.update"; message: Message }
  | { type: "message.delete"; channelId: string; messageId: number }
  | { type: "typing"; channelId: string; userId: string }
  | { type: "voice.channel"; channelId: string; members: VoiceMember[] }
  | { type: "watch.state"; state: WatchState }
  | { type: "notice"; level: "info" | "error"; text: string };

export interface ApiErrorBody {
  error: string;
  /** Erros de validação por campo, quando houver. */
  fields?: Record<string, string>;
}
