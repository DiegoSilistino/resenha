import type { ProfileLook } from "./types.ts";

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
  /** A foto é recortada e reduzida no navegador (256 px); o limite só barra abuso. */
  avatarMaxBytes: 2 * 1024 * 1024,
  avatarMaxSide: 1024,
  avatarMinSide: 32,
  /** Emojis diferentes numa mesma mensagem. */
  reactionsPerMessage: 20,
  /** Soundboard: sons curtos, poucos e leves. */
  soundMaxBytes: 1024 * 1024,
  soundMaxSeconds: 5,
  soundNameMax: 24,
  soundsMax: 60,
  /** Busca: resultados por página. */
  searchPageSize: 25,
  /** Ao pular para uma mensagem antiga (busca, citação), carrega de uma vez até este tanto. */
  jumpMaxMessages: 1_500,
  /** Intervalo mínimo entre dois sons da mesma pessoa na mesa de sons. */
  soundboardCooldownMs: 1_500,
  /** Perfil: "Jogando CS2" e o recado do cartão. */
  activityMax: 60,
  noteMax: 140,
  /** Capa do perfil: imagem ou GIF, sem recorte no navegador. */
  bannerMaxBytes: 8 * 1024 * 1024,
  bannerMaxSide: 4096,
} as const;

/** Cores do perfil (cartão, molduras, nick colorido): mesmo brilho, matizes diferentes. */
export const PROFILE_COLORS = [40, 85, 125, 160, 215, 260, 305, 350].map((h) => `oklch(0.8 0.13 ${h})`);

export const DEFAULT_LOOK: ProfileLook = {
  a: null,
  b: null,
  twoTone: false,
  banner: "cor",
  frame: "nenhuma",
  nickStyle: "padrao",
  font: "onest",
};

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
