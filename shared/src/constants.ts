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
  /** A foto parada é recortada e reduzida no navegador (256 px); a animada (GIF) vai inteira, daí a folga. */
  avatarMaxBytes: 4 * 1024 * 1024,
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
  /** Grupo privado: pessoas, contando quem criou. */
  groupMax: 10,
  rodaNameMax: 40,
} as const;

/** Cores do perfil (cartão, molduras, nick colorido): mesmo brilho, matizes diferentes. */
export const PROFILE_COLORS = [40, 85, 125, 160, 215, 260, 305, 350].map((h) => `oklch(0.8 0.13 ${h})`);

export const DEFAULT_LOOK: ProfileLook = {
  a: null,
  b: null,
  twoTone: false,
  banner: "cor",
  bannerX: 50,
  bannerY: 50,
  bannerZoom: 1,
  frame: "nenhuma",
  nickStyle: "padrao",
  font: "onest",
  avatarX: 50,
  avatarY: 50,
  avatarZoom: 1,
  deco: null,
  nickFx: null,
  cardFx: null,
};

/** Loja: extras do perfil comprados com moedas. O que já existia (molduras, degradê, fontes, capa) segue grátis. */
export const SHOP_SLOTS = ["deco", "nickFx", "cardFx"] as const;
export type ShopSlot = (typeof SHOP_SLOTS)[number];

export interface ShopItem {
  id: string;
  slot: ShopSlot;
  name: string;
  price: number;
}

export const SHOP_ITEMS: readonly ShopItem[] = [
  { id: "brilho", slot: "deco", name: "Brilhinhos", price: 150 },
  { id: "neon", slot: "deco", name: "Neon pulsante", price: 200 },
  { id: "arco-iris", slot: "deco", name: "Anel arco-íris", price: 300 },
  { id: "nick-neon", slot: "nickFx", name: "Nick neon", price: 150 },
  { id: "nick-brilho", slot: "nickFx", name: "Nick com brilho", price: 200 },
  { id: "nick-arco-iris", slot: "nickFx", name: "Nick arco-íris", price: 250 },
  { id: "estrelas", slot: "cardFx", name: "Céu estrelado", price: 250 },
  { id: "aurora", slot: "cardFx", name: "Aurora", price: 300 },
];

export const shopItem = (id: string): ShopItem | undefined => SHOP_ITEMS.find((i) => i.id === id);

/** Como se ganha moeda: uma vez por dia ao entrar e por minuto em call com mais alguém (com teto diário). */
export const COINS = { daily: 25, perVoiceMinute: 1, voiceDailyMax: 60 } as const;

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
