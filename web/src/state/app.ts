import { create } from "zustand";
import type {
  CallRing,
  Channel,
  Conversation,
  FriendEntry,
  HelloEvent,
  Permission,
  Roda,
  RodaSummary,
  Me,
  Message,
  MessageReference,
  PublicUser,
  Reaction,
  ServerEvent,
  SoundboardSound,
  UserNotice,
  VoiceMember,
  Wallet,
  WatchState,
} from "@resenha/shared";
import { PERMISSIONS } from "@resenha/shared";
import { mentionsUser } from "../chat/mentions.ts";

export interface ChannelMessages {
  items: Message[];
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
}

type ConnectionStatus = "connecting" | "online" | "offline";

interface AppState {
  /** null = ainda verificando sessão; false = sem login */
  me: Me | null | false;
  connection: ConnectionStatus;
  /** true depois do primeiro "hello": dados completos disponíveis */
  ready: boolean;
  users: Record<string, PublicUser>;
  online: Record<string, true>;
  channels: Channel[];
  voice: Record<string, VoiceMember[]>;
  watch: Record<string, WatchState>;
  messages: Record<string, ChannelMessages>;
  /** canal -> usuário -> horário em que o "digitando" expira */
  typing: Record<string, Record<string, number>>;
  /** canal -> mensagens novas desde a última visita */
  unread: Record<string, number>;
  /** canal -> menções a você entre as não lidas */
  mentions: Record<string, number>;
  /** Mensagens que chegaram no canal aberto enquanto a janela estava em segundo plano. */
  awayUnread: number;
  /** canal de texto aberto agora (para não marcar como não lido) */
  activeChannelId: string | null;
  /** Recursos que dependem da configuração do servidor (ex.: chave do GIPHY). */
  features: { gifs: boolean };
  /** Sons da mesa da turma e da sua mesa pessoal, do mais antigo para o mais novo. */
  sounds: SoundboardSound[];
  /** Suas figurinhas (criadas e favoritadas), das mais novas para as mais antigas. */
  stickers: string[];
  /** Quem você bloqueou: as mensagens dessas pessoas ficam escondidas. */
  blocked: string[];
  /** Admins: denúncias ainda não resolvidas (acende o aviso do painel). */
  openReports: number;
  /** Admins: id do erro mais recente no painel de erros (compara com o último visto neste aparelho). */
  latestErrorId: number;
  /** Criador do site: feedback mais recente. null = você não é o criador (a aba Feedback não aparece). */
  latestFeedbackId: number | null;
  /** Suas conversas privadas (a dois e grupos). */
  conversations: Record<string, Conversation>;
  /** Amigos e pedidos, pela pessoa do outro lado. */
  friends: Record<string, FriendEntry>;
  /** Rodas de que você faz parte. */
  rodas: Record<string, Roda>;
  /** Rodas abertas em que você ainda não está. */
  openRodas: RodaSummary[];
  /** Suas moedas e itens da loja. */
  wallet: Wallet;
  /** Avisos guardados para você (sugestão implementada…), até você dispensar. */
  notices: UserNotice[];
  /** Chamadas tocando nas suas conversas: canal -> quem ligou e para quem toca. */
  rings: Record<string, CallRing>;
  /** O servidor está com uma versão do site mais nova do que a aberta aqui (houve deploy). */
  updateAvailable: boolean;

  setMe(me: Me | false): void;
  setWallet(wallet: Wallet): void;
  dismissNotice(id: number): void;
  setConnection(status: ConnectionStatus): void;
  setActiveChannel(id: string | null): void;
  /** A pessoa voltou para a janela: o que chegou no canal aberto foi visto. */
  markWindowSeen(): void;
  applyEvent(event: ServerEvent): void;
  setMessages(channelId: string, patch: Partial<ChannelMessages>): void;
  prependMessages(channelId: string, older: Message[], hasMore: boolean): void;
  upsertMessage(message: Message): void;
  /** Reação aplicada na hora, antes da confirmação do servidor. */
  applyLocalReaction(message: Message, emoji: string, userId: string, on: boolean): void;
  reset(): void;
}

const emptyMessages = (): ChannelMessages => ({ items: [], hasMore: true, loaded: false, loading: false });
const TYPING_TTL_MS = 6_000;

const initial = {
  me: null,
  connection: "connecting" as ConnectionStatus,
  ready: false,
  users: {},
  online: {},
  channels: [],
  voice: {},
  watch: {},
  messages: {},
  typing: {},
  unread: {},
  mentions: {},
  awayUnread: 0,
  activeChannelId: null,
  features: { gifs: false },
  sounds: [] as SoundboardSound[],
  stickers: [] as string[],
  blocked: [] as string[],
  openReports: 0,
  latestErrorId: 0,
  latestFeedbackId: null,
  conversations: {} as Record<string, Conversation>,
  friends: {} as Record<string, FriendEntry>,
  rodas: {} as Record<string, Roda>,
  openRodas: [] as RodaSummary[],
  wallet: { coins: 0, items: [] } as Wallet,
  notices: [] as UserNotice[],
  rings: {} as Record<string, CallRing>,
  updateAvailable: false,
};

/** A pessoa está olhando para o app agora? */
export const windowFocused = () =>
  typeof document === "undefined" || (document.visibilityState === "visible" && document.hasFocus());

export const useApp = create<AppState>()((set, get) => ({
  ...initial,

  setMe: (me) => set({ me }),
  setWallet: (wallet) => set({ wallet }),
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  setConnection: (connection) => set({ connection }),
  setActiveChannel: (id) =>
    set((s) => {
      if (!id || (!s.unread[id] && !s.mentions[id])) return { activeChannelId: id, awayUnread: 0 };
      const unread = { ...s.unread };
      const mentions = { ...s.mentions };
      delete unread[id];
      delete mentions[id];
      return { activeChannelId: id, unread, mentions, awayUnread: 0 };
    }),

  markWindowSeen: () => {
    if (get().awayUnread) set({ awayUnread: 0 });
  },

  setMessages: (channelId, patch) =>
    set((s) => ({
      messages: { ...s.messages, [channelId]: { ...(s.messages[channelId] ?? emptyMessages()), ...patch } },
    })),

  prependMessages: (channelId, older, hasMore) =>
    set((s) => {
      const cur = s.messages[channelId] ?? emptyMessages();
      const known = new Set(cur.items.map((m) => m.id));
      const items = [...older.filter((m) => !known.has(m.id)), ...cur.items];
      return { messages: { ...s.messages, [channelId]: { ...cur, items, hasMore, loaded: true, loading: false } } };
    }),

  upsertMessage: (message) =>
    set((s) => {
      const cur = s.messages[message.channelId];
      if (!cur?.loaded) return {};
      const idx = cur.items.findIndex((m) => m.id === message.id);
      const items =
        idx === -1
          ? [...cur.items, message].sort((a, b) => a.id - b.id)
          : cur.items.map((m) => (m.id === message.id ? message : m));
      return { messages: { ...s.messages, [message.channelId]: { ...cur, items } } };
    }),

  applyLocalReaction: (message, emoji, userId, on) => {
    const cur = get().messages[message.channelId]?.items.find((m) => m.id === message.id);
    if (!cur) return;
    get().upsertMessage({ ...cur, reactions: toggleReactionList(cur.reactions, emoji, userId, on) });
  },

  reset: () => set({ ...initial, me: false }),

  applyEvent: (event) => {
    const s = get();
    switch (event.type) {
      case "hello":
        return set(fromHello(event, s.ready));
      case "presence": {
        const online = { ...s.online };
        if (event.online) online[event.userId] = true;
        else delete online[event.userId];
        return set({ online });
      }
      case "user.upsert": {
        const patch: Partial<AppState> = { users: { ...s.users, [event.user.id]: event.user } };
        if (s.me && s.me.id === event.user.id) patch.me = event.user;
        return set(patch);
      }
      case "channel.upsert": {
        const others = s.channels.filter((c) => c.id !== event.channel.id);
        return set({ channels: sortChannels([...others, event.channel]) });
      }
      case "channel.remove": {
        const messages = { ...s.messages };
        delete messages[event.channelId];
        const voice = { ...s.voice };
        delete voice[event.channelId];
        const watch = { ...s.watch };
        delete watch[event.channelId];
        return set({ channels: s.channels.filter((c) => c.id !== event.channelId), messages, voice, watch });
      }
      case "message.create": {
        const m = event.message;
        get().upsertMessage(m);
        // quem enviou já não está "digitando"
        const typing = withoutTyping(get().typing, m.channelId, m.authorId);
        const conv = s.conversations[m.channelId];
        const conversations = conv ? { ...s.conversations, [conv.id]: { ...conv, lastMessage: m } } : s.conversations;
        if (!s.me || m.authorId === s.me.id) return set({ typing, conversations });
        if (m.channelId === s.activeChannelId) {
          return set({ typing, conversations, awayUnread: windowFocused() ? 0 : s.awayUnread + 1 });
        }
        const patch: Partial<AppState> = {
          typing,
          conversations,
          unread: { ...s.unread, [m.channelId]: (s.unread[m.channelId] ?? 0) + 1 },
        };
        if (mentionsMe(m, s.me)) {
          patch.mentions = { ...s.mentions, [m.channelId]: (s.mentions[m.channelId] ?? 0) + 1 };
        }
        return set(patch);
      }
      case "message.update":
        get().upsertMessage(event.message);
        // citações dessa mensagem em respostas mostram o texto novo
        return set({
          messages: patchReplies(get().messages, event.message.channelId, event.message.id, (r) => ({
            ...r,
            content: event.message.content.slice(0, 200),
            attachmentCount: event.message.attachments.length,
          })),
        });
      case "message.reactions": {
        const cur = s.messages[event.channelId];
        if (!cur?.loaded) return;
        return set({
          messages: {
            ...s.messages,
            [event.channelId]: {
              ...cur,
              items: cur.items.map((m) => (m.id === event.messageId ? { ...m, reactions: event.reactions } : m)),
            },
          },
        });
      }
      case "message.delete": {
        const cur = s.messages[event.channelId];
        if (!cur) return;
        const messages = {
          ...s.messages,
          [event.channelId]: { ...cur, items: cur.items.filter((m) => m.id !== event.messageId) },
        };
        return set({
          messages: patchReplies(messages, event.channelId, event.messageId, (r) => ({
            ...r,
            deleted: true,
            authorId: null,
            content: "",
            attachmentCount: 0,
          })),
        });
      }
      case "typing": {
        const channelTyping = { ...(s.typing[event.channelId] ?? {}), [event.userId]: Date.now() + TYPING_TTL_MS };
        return set({ typing: { ...s.typing, [event.channelId]: channelTyping } });
      }
      case "voice.channel":
        return set({ voice: { ...s.voice, [event.channelId]: event.members } });
      case "watch.state":
        return set({ watch: { ...s.watch, [event.state.channelId]: event.state } });
      case "sound.upsert":
        return set({ sounds: [...s.sounds.filter((x) => x.id !== event.sound.id), event.sound] });
      case "sound.remove":
        return set({ sounds: s.sounds.filter((x) => x.id !== event.soundId) });
      case "stickers":
        return set({ stickers: event.ids });
      case "blocks":
        return set({ blocked: event.ids });
      case "admin.reports":
        return set({ openReports: event.open });
      case "admin.error":
        return set({ latestErrorId: Math.max(s.latestErrorId, event.entry.id) });
      case "admin.feedback":
        return set({ latestFeedbackId: Math.max(s.latestFeedbackId ?? 0, event.entry.id) });
      case "conversation.upsert":
        return set({ conversations: { ...s.conversations, [event.conversation.id]: event.conversation } });
      case "conversation.remove": {
        const conversations = { ...s.conversations };
        delete conversations[event.conversationId];
        const messages = { ...s.messages };
        delete messages[event.conversationId];
        const unread = { ...s.unread };
        delete unread[event.conversationId];
        return set({ conversations, messages, unread });
      }
      case "conversation.read": {
        const conv = s.conversations[event.conversationId];
        if (!conv) return;
        const reads = { ...conv.reads, [event.userId]: Math.max(conv.reads[event.userId] ?? 0, event.messageId) };
        return set({ conversations: { ...s.conversations, [conv.id]: { ...conv, reads } } });
      }
      case "roda.upsert":
        return set({ rodas: { ...s.rodas, [event.roda.id]: event.roda } });
      case "roda.open":
        return set({ openRodas: [...s.openRodas.filter((r) => r.id !== event.roda.id), event.roda] });
      case "roda.closed":
        return set({ openRodas: s.openRodas.filter((r) => r.id !== event.rodaId) });
      case "friend.upsert":
        return set({ friends: { ...s.friends, [event.friend.userId]: event.friend } });
      case "friend.remove": {
        const friends = { ...s.friends };
        delete friends[event.userId];
        return set({ friends });
      }
      case "soundboard.played":
        return; // tocado pelo módulo da mesa de sons
      case "wallet":
        return set({ wallet: event.wallet });
      case "user.notice":
        return set({ notices: [...s.notices.filter((n) => n.id !== event.notice.id), event.notice] });
      case "call.ring": {
        const rings = { ...s.rings };
        if (event.ring) rings[event.channelId] = event.ring;
        else delete rings[event.channelId];
        return set({ rings });
      }
      case "call.declined":
        return; // aviso para quem ligou: tratado pelo cliente de tempo real
      case "pong":
      case "notice":
        return; // tratados pelo cliente de tempo real
    }
  },
}));

function fromHello(e: HelloEvent, wasReady: boolean): Partial<AppState> {
  const patch: Partial<AppState> = {
    me: e.me,
    ready: true,
    users: Object.fromEntries(e.users.map((u) => [u.id, u])),
    online: Object.fromEntries(e.online.map((id) => [id, true as const])),
    channels: sortChannels(e.channels),
    voice: e.voice,
    watch: e.watch,
    features: e.features ?? { gifs: false },
    sounds: e.sounds ?? [],
    stickers: e.stickers ?? [],
    blocked: e.blocked ?? [],
    openReports: e.openReports ?? 0,
    latestErrorId: e.latestErrorId ?? 0,
    latestFeedbackId: e.latestFeedbackId ?? null,
    conversations: Object.fromEntries((e.conversations ?? []).map((c) => [c.id, c])),
    friends: Object.fromEntries((e.friends ?? []).map((f) => [f.userId, f])),
    rodas: Object.fromEntries((e.rodas ?? []).map((r) => [r.id, r])),
    openRodas: e.openRodas ?? [],
    wallet: e.wallet ?? { coins: 0, items: [] },
    notices: e.notices ?? [],
    rings: e.rings ?? {},
    // não lidas das conversas vêm do servidor (ele guarda até onde você leu)
    unread: { ...useApp.getState().unread, ...(e.conversationUnread ?? {}) },
  };
  // Numa reconexão, mensagens podem ter chegado enquanto estávamos fora: recarrega sob demanda.
  if (wasReady) patch.messages = {};
  return patch;
}

/** Menção a você: @seu-usuario no texto, ou resposta a uma mensagem sua (como no Discord). */
export function mentionsMe(m: Pick<Message, "content" | "replyTo">, me: Pick<Me, "id" | "username">): boolean {
  return mentionsUser(m.content, me.username) || m.replyTo?.authorId === me.id;
}

function patchReplies(
  messages: AppState["messages"],
  channelId: string,
  originalId: number,
  patch: (r: MessageReference) => MessageReference,
): AppState["messages"] {
  const cur = messages[channelId];
  if (!cur?.items.some((m) => m.replyTo?.id === originalId)) return messages;
  return {
    ...messages,
    [channelId]: {
      ...cur,
      items: cur.items.map((m) => (m.replyTo?.id === originalId ? { ...m, replyTo: patch(m.replyTo) } : m)),
    },
  };
}

/** Lista de reações com `userId` ligado ou desligado em `emoji` (sem mudar a ordem dos outros). */
export function toggleReactionList(reactions: Reaction[], emoji: string, userId: string, on: boolean): Reaction[] {
  const existing = reactions.find((r) => r.emoji === emoji);
  if (on) {
    if (existing?.userIds.includes(userId)) return reactions;
    if (!existing) return [...reactions, { emoji, userIds: [userId] }];
    return reactions.map((r) => (r.emoji === emoji ? { ...r, userIds: [...r.userIds, userId] } : r));
  }
  if (!existing?.userIds.includes(userId)) return reactions;
  return reactions
    .map((r) => (r.emoji === emoji ? { ...r, userIds: r.userIds.filter((id) => id !== userId) } : r))
    .filter((r) => r.userIds.length > 0);
}

function withoutTyping(typing: AppState["typing"], channelId: string, userId: string) {
  if (!typing[channelId]?.[userId]) return typing;
  const ch = { ...typing[channelId] };
  delete ch[userId];
  return { ...typing, [channelId]: ch };
}

const sortChannels = (channels: Channel[]) =>
  [...channels].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

// ---------- seletores ----------

export const userById = (id: string) => (s: AppState) => s.users[id];

export function displayNameOf(users: Record<string, PublicUser>, id: string): string {
  return users[id]?.displayName ?? "Alguém";
}

/**
 * Total para o título da aba: "(3) #geral". Chat de canal de voz só entra quando te
 * mencionam (é conversa de quem está na call).
 */
export const unreadTotal = (s: Pick<AppState, "unread" | "mentions" | "awayUnread" | "channels" | "conversations">) => {
  let total = s.awayUnread;
  for (const c of s.channels) total += c.kind === "text" ? (s.unread[c.id] ?? 0) : (s.mentions[c.id] ?? 0);
  for (const id in s.conversations) total += s.unread[id] ?? 0;
  return total;
};

/** Conversas com mensagem nova (o número na aba Conversas). */
export const unreadConversations = (s: Pick<AppState, "unread" | "conversations">) =>
  Object.keys(s.conversations).filter((id) => (s.unread[id] ?? 0) > 0).length;

/** Na conversa a dois, a outra pessoa. */
export const otherMember = (c: Conversation, meId: string | undefined) => c.memberIds.find((id) => id !== meId) ?? c.memberIds[0]!;

/** Título da conversa: o nome do grupo ou o da outra pessoa. */
export function conversationTitle(c: Conversation, users: Record<string, PublicUser>, meId: string | undefined): string {
  if (c.type === "group") return c.name || "Grupo";
  return displayNameOf(users, otherMember(c, meId));
}

/** A conversa como canal, para o chat (mensagens, anexos, chamada) funcionar igual. */
export function conversationChannel(c: Conversation, users: Record<string, PublicUser>, meId: string | undefined): Channel {
  return { id: c.id, name: conversationTitle(c, users, meId), kind: "text", position: 0, conversation: c.type };
}

// ---------- rodas ----------

/** Cor da roda (faixa, ícone) a partir do matiz. */
export const rodaColor = (hue: number) => `oklch(0.8 0.13 ${hue})`;

/** O cargo de alguém na roda. */
export const roleOf = (roda: Roda, userId: string) => roda.roles.find((r) => r.id === roda.members[userId]);

/** O que você pode fazer na roda (admin do servidor pode tudo onde está). */
export function rodaPerms(roda: Roda | undefined, me: Me | null | false): Set<Permission> {
  if (!roda || !me || !(me.id in roda.members)) return new Set();
  if (me.role === "admin") return new Set(PERMISSIONS);
  return new Set(roleOf(roda, me.id)?.perms ?? []);
}

/** Dono (ou admin do servidor): mexe em nome, cargos e quem tem qual cargo. */
export const isRodaOwner = (roda: Roda | undefined, me: Me | null | false) =>
  !!roda && !!me && (me.role === "admin" || !!roleOf(roda, me.id)?.owner);

/** Você pode isto neste canal? Na conversa, o básico (sem moderar); na sala, o que seu cargo permite. */
export function useChannelPerm(channelId: string | null, perm: Permission): boolean {
  return useApp((s) => {
    if (!channelId) return false;
    if (s.conversations[channelId]) return perm !== "convidar" && perm !== "salas" && perm !== "expulsar";
    const c = s.channels.find((x) => x.id === channelId);
    return !!c?.rodaId && rodaPerms(s.rodas[c.rodaId], s.me).has(perm);
  });
}
