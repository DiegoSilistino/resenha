/**
 * Contrato entre cliente e servidor.
 * - Schemas zod validam tudo que chega ao servidor (REST e WebSocket).
 * - `ServerEvent` descreve tudo que o servidor envia pelo WebSocket.
 */
import { z } from "zod";
import { AVATAR_COLORS, LIMITS, PROFILE_COLORS, USERNAME_PATTERN } from "./constants.ts";
import { PERMISSIONS } from "./types.ts";
import type {
  Channel,
  ClientErrorEntry,
  Conversation,
  FriendEntry,
  Me,
  Roda,
  RodaSummary,
  Message,
  PublicUser,
  Reaction,
  SoundboardSound,
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

const profileColor = z.string().refine((c) => PROFILE_COLORS.includes(c), "Cor fora da paleta");

export const lookSchema = z.object({
  a: profileColor.nullable(),
  b: profileColor.nullable(),
  twoTone: z.boolean(),
  banner: z.enum(["cor", "imagem"]),
  frame: z.enum(["nenhuma", "anel", "duplo", "tracejado", "halo"]),
  nickStyle: z.enum(["padrao", "cor", "gradiente"]),
  font: z.enum(["onest", "mono", "larga", "serif", "pixel"]),
});

export const userStatusSchema = z.enum(["online", "ausente", "ocupado", "invisivel"]);

/** Texto curto de uma linha (atividade, recado): sem quebras de linha. */
const oneLine = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max));

export const updateMeBody = z
  .object({
    displayName: displayNameSchema.optional(),
    avatarColor: z.enum(AVATAR_COLORS).optional(),
    status: userStatusSchema.optional(),
    activity: oneLine(LIMITS.activityMax).optional(),
    note: oneLine(LIMITS.noteMax).optional(),
    look: lookSchema.optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), "Nada para alterar");

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
    replyTo: z.number().int().positive().optional(),
  })
  .refine((b) => b.content.trim().length > 0 || b.attachmentIds.length > 0, "Mensagem vazia");

export const editMessageBody = z.object({
  content: z.string().trim().min(1).max(LIMITS.messageMax),
});

/**
 * Um único emoji (inclui tons de pele, bandeiras e combinações com ZWJ), nunca texto livre.
 * RegExp criada em tempo de execução: o TypeScript recusa a flag "v" com target ES2023.
 */
const SINGLE_EMOJI = new RegExp("^\\p{RGI_Emoji}$", "v");

export function isSingleEmoji(value: string): boolean {
  return value.length <= 32 && SINGLE_EMOJI.test(value);
}

export const reactionEmojiSchema = z.string().max(32).refine(isSingleEmoji, "Emoji inválido");

export const listMessagesQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  /** Pular para uma mensagem antiga: traz tudo de `before` até esta (inclusive), mais um pouco de contexto. */
  since: z.coerce.number().int().positive().optional(),
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
  z.object({ type: z.literal("soundboard.play"), channelId: id, soundId: id }),
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
  /** Recursos que dependem de configuração no servidor. */
  features: { gifs: boolean };
  sounds: SoundboardSound[];
  /** Só para admins: id do erro mais recente no painel (0 = nenhum). Acende o aviso na engrenagem. */
  latestErrorId?: number;
  /** Suas conversas privadas, com quantas mensagens você ainda não leu em cada uma. */
  conversations: Conversation[];
  conversationUnread: Record<string, number>;
  friends: FriendEntry[];
  /** Rodas de que você faz parte (os canais delas vêm em `channels`). */
  rodas: Roda[];
  /** Rodas abertas em que você ainda não está. */
  openRodas: RodaSummary[];
}

export const friendRequestBody = z.object({
  /** Usuário (com ou sem @). */
  username: z
    .string()
    .trim()
    .transform((s) => s.replace(/^@/, "").toLowerCase())
    .pipe(usernameSchema),
});

export const createConversationBody = z.object({
  /** Com quem (sem contar você): 1 pessoa = conversa a dois; mais = grupo. */
  userIds: z
    .array(id)
    .min(1, "Escolha alguém")
    .max(LIMITS.groupMax - 1, `Um grupo tem no máximo ${LIMITS.groupMax} pessoas, contando você`),
  name: z.string().trim().max(LIMITS.channelNameMax).optional(),
});

export const readConversationBody = z.object({ messageId: z.number().int().positive() });

// ---------- rodas ----------

const rodaName = z.string().trim().min(1, "Dê um nome à roda").max(LIMITS.rodaNameMax);
const rodaDescription = z.string().trim().max(LIMITS.noteMax);

export const RODA_TEMPLATES = ["amigos", "estudos", "jogos"] as const;

export const createRodaBody = z.object({
  name: rodaName,
  description: rodaDescription.default(""),
  privacy: z.enum(["privada", "aberta"]).default("privada"),
  template: z.enum(RODA_TEMPLATES).default("amigos"),
});

export const updateRodaBody = z
  .object({
    name: rodaName.optional(),
    description: rodaDescription.optional(),
    hue: z.number().int().min(0).max(359).optional(),
    privacy: z.enum(["privada", "aberta"]).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), "Nada para alterar");

export const roleBody = z.object({
  name: z.string().trim().min(1, "Dê um nome ao cargo").max(24),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, "Cor inválida"),
  perms: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
});

export const memberRoleBody = z.object({ roleId: id });

export const rodaInviteBody = z.object({
  /** null = não expira */
  expiresInMinutes: z
    .number()
    .int()
    .min(5)
    .max(60 * 24 * 90)
    .nullable()
    .default(60 * 24 * 7),
  maxUses: z.number().int().min(1).max(100).default(25),
  approval: z.boolean().default(false),
});

/** O que a página de convite mostra antes de entrar. */
export interface InviteInfo {
  role: "admin" | "member";
  roda: { name: string; hue: number; memberCount: number; approval: boolean } | null;
}

export const clientErrorBody = z.object({
  kind: z.enum(["voz", "microfone", "tela", "ruido", "inesperado"]),
  message: z.string().trim().min(1).max(500),
  detail: z.string().max(2_000).default(""),
  context: z
    .record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()]))
    .refine((c) => Object.keys(c).length <= 20, "Contexto grande demais")
    .default({}),
});

export const searchQuery = z.object({
  q: z.string().trim().min(2, "Digite pelo menos 2 letras").max(100),
  channelId: id.optional(),
  /** Paginação: só resultados mais antigos que esta mensagem. */
  before: z.coerce.number().int().positive().optional(),
});

export const soundMeta = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Dê um nome ao som")
    .max(LIMITS.soundNameMax, `Máximo de ${LIMITS.soundNameMax} caracteres`),
  emoji: z.string().max(32).refine(isSingleEmoji, "Escolha um emoji").default("🔊"),
});

export const gifSearchQuery = z.object({
  q: z.string().trim().max(50).default(""),
  offset: z.coerce.number().int().min(0).max(4_999).default(0),
});

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
  | { type: "message.reactions"; channelId: string; messageId: number; reactions: Reaction[] }
  | { type: "typing"; channelId: string; userId: string }
  | { type: "voice.channel"; channelId: string; members: VoiceMember[] }
  | { type: "watch.state"; state: WatchState }
  | { type: "notice"; level: "info" | "error"; text: string }
  | { type: "sound.upsert"; sound: SoundboardSound }
  | { type: "sound.remove"; soundId: string }
  /** Só para quem está naquela chamada. */
  | { type: "soundboard.played"; channelId: string; soundId: string; userId: string }
  /** Só para administradores: um navegador reportou uma falha. */
  | { type: "admin.error"; entry: ClientErrorEntry }
  /** Só para os membros da conversa. */
  | { type: "conversation.upsert"; conversation: Conversation }
  | { type: "conversation.remove"; conversationId: string }
  | { type: "conversation.read"; conversationId: string; userId: string; messageId: number }
  /** Só para as duas pessoas envolvidas. */
  | { type: "friend.upsert"; friend: FriendEntry }
  | { type: "friend.remove"; userId: string }
  /** Só para quem faz parte (quem entra ou sai recebe um "hello" novo). */
  | { type: "roda.upsert"; roda: Roda };

export interface ApiErrorBody {
  error: string;
  /** Erros de validação por campo, quando houver. */
  fields?: Record<string, string>;
}
