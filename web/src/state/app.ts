import { create } from "zustand";
import type {
  Channel,
  HelloEvent,
  Me,
  Message,
  MessageReference,
  PublicUser,
  Reaction,
  ServerEvent,
  VoiceMember,
  WatchState,
} from "@resenha/shared";
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

  setMe(me: Me | false): void;
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
};

/** A pessoa está olhando para o app agora? */
export const windowFocused = () =>
  typeof document === "undefined" || (document.visibilityState === "visible" && document.hasFocus());

export const useApp = create<AppState>()((set, get) => ({
  ...initial,

  setMe: (me) => set({ me }),
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
        if (!s.me || m.authorId === s.me.id) return set({ typing });
        if (m.channelId === s.activeChannelId) {
          return set({ typing, awayUnread: windowFocused() ? 0 : s.awayUnread + 1 });
        }
        const patch: Partial<AppState> = { typing, unread: { ...s.unread, [m.channelId]: (s.unread[m.channelId] ?? 0) + 1 } };
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
export const unreadTotal = (s: Pick<AppState, "unread" | "mentions" | "awayUnread" | "channels">) => {
  let total = s.awayUnread;
  for (const c of s.channels) total += c.kind === "text" ? (s.unread[c.id] ?? 0) : (s.mentions[c.id] ?? 0);
  return total;
};
