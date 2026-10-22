/** Nome exibido no app. Troque aqui para renomear o produto inteiro. */
export const APP_NAME = "Resenha";

export const LIMITS = {
  usernameMin: 3,
  usernameMax: 24,
  displayNameMax: 32,
  passwordMin: 8,
  passwordMax: 200,
  channelNameMax: 32,
  messageMax: 4000,
  attachmentsPerMessage: 10,
  uploadMaxBytes: 25 * 1024 * 1024,
  messagesPageSize: 50,
  watchQueueMax: 100,
} as const;

/** Usuário: letras minúsculas, números, ponto, hífen e underline. */
export const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

/** Paleta de cores para avatares (sem foto no MVP). */
export const AVATAR_COLORS = [
  "#e8590c",
  "#f08c00",
  "#2f9e44",
  "#0c8599",
  "#1971c2",
  "#6741d9",
  "#c2255c",
  "#868e96",
] as const;

export type AvatarColor = (typeof AVATAR_COLORS)[number];

/** Código de fechamento do WebSocket quando a sessão deixa de valer. */
export const WS_CLOSE_SESSION_REVOKED = 4001;
/** Código de fechamento quando não há sessão no handshake. */
export const WS_CLOSE_UNAUTHORIZED = 4401;

/** Tópico usado no data channel do LiveKit para legendas ao vivo. */
export const CAPTIONS_TOPIC = "captions";

/** Prefixo das salas LiveKit; a sala é `${prefix}${channelId}`. */
export const LIVEKIT_ROOM_PREFIX = "ch_";
