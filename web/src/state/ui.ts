import { create } from "zustand";

/** Pedido para rolar a conversa até uma mensagem (clique numa citação ou num resultado da busca). */
export interface JumpRequest {
  channelId: string;
  messageId: number;
  /** Muda a cada pedido, para clicar duas vezes na mesma citação funcionar. */
  nonce: number;
}

/** Abas do painel do admin (a ordem e os nomes ficam no AdminModal). */
export type AdminTab = "invites" | "members" | "backup" | "errors" | "feedback";
export type RodaSettingsTab = "geral" | "cargos" | "membros" | "convites" | "salas";
export type SettingsTab = "profile" | "shop" | "appearance" | "audio" | "notifications" | "captions" | "account";

interface UiState {
  settingsOpen: boolean;
  adminOpen: boolean;
  /** Aba pedida ao abrir o painel (ex.: "+ Texto" abre direto em Canais). */
  adminTab: AdminTab | null;
  /** Aba pedida ao abrir as configurações ("Personalizar" no cartão abre em Perfil). */
  settingsTab: SettingsTab | null;
  /** Cartão de perfil aberto (id da pessoa). */
  profileId: string | null;
  newGroupOpen: boolean;
  /** Ajustes de uma roda abertos (e em qual aba). */
  rodaSettings: { rodaId: string; tab: RodaSettingsTab } | null;
  newRodaOpen: boolean;
  /** Criando sala nova nesta roda. */
  newRoom: { rodaId: string; kind: "text" | "voice" } | null;
  /** Janela "Convidar para a roda" (mandar o link no privado de um amigo) aberta para esta roda. */
  inviteRodaId: string | null;
  shareDialogOpen: boolean;
  /** Painel de busca de mensagens aberto. */
  searchOpen: boolean;
  /** Título da página atual (o contador de não lidas é somado na frente). */
  pageTitle: string;
  /** canal -> mensagem que está sendo respondida no compositor */
  replying: Record<string, number>;
  /** Mensagem aberta para edição (só uma por vez, como no Discord). */
  editingId: number | null;
  jump: JumpRequest | null;
  setSettingsOpen(open: boolean, tab?: SettingsTab): void;
  setAdminOpen(open: boolean, tab?: AdminTab): void;
  openProfile(userId: string | null): void;
  setNewGroupOpen(open: boolean): void;
  openRodaSettings(rodaId: string | null, tab?: RodaSettingsTab): void;
  setNewRodaOpen(open: boolean): void;
  setNewRoom(room: { rodaId: string; kind: "text" | "voice" } | null): void;
  setInviteRoda(rodaId: string | null): void;
  setShareDialogOpen(open: boolean): void;
  setSearchOpen(open: boolean): void;
  setPageTitle(title: string): void;
  setReplying(channelId: string, messageId: number | null): void;
  setEditing(id: number | null): void;
  jumpTo(channelId: string, messageId: number): void;
}

let jumpNonce = 0;

export const useUi = create<UiState>()((set) => ({
  settingsOpen: false,
  adminOpen: false,
  adminTab: null,
  settingsTab: null,
  profileId: null,
  newGroupOpen: false,
  rodaSettings: null,
  newRodaOpen: false,
  newRoom: null,
  inviteRodaId: null,
  shareDialogOpen: false,
  searchOpen: false,
  pageTitle: "Resenha",
  replying: {},
  editingId: null,
  jump: null,
  setSettingsOpen: (settingsOpen, tab) => set({ settingsOpen, settingsTab: tab ?? null }),
  setAdminOpen: (adminOpen, tab) => set({ adminOpen, adminTab: tab ?? null }),
  openProfile: (profileId) => set({ profileId }),
  setNewGroupOpen: (newGroupOpen) => set({ newGroupOpen }),
  openRodaSettings: (rodaId, tab = "geral") => set({ rodaSettings: rodaId ? { rodaId, tab } : null }),
  setNewRodaOpen: (newRodaOpen) => set({ newRodaOpen }),
  setNewRoom: (newRoom) => set({ newRoom }),
  setInviteRoda: (inviteRodaId) => set({ inviteRodaId }),
  setShareDialogOpen: (shareDialogOpen) => set({ shareDialogOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setPageTitle: (pageTitle) => set({ pageTitle }),
  setReplying: (channelId, messageId) =>
    set((s) => {
      const replying = { ...s.replying };
      if (messageId === null) delete replying[channelId];
      else replying[channelId] = messageId;
      return { replying };
    }),
  setEditing: (editingId) => set({ editingId }),
  jumpTo: (channelId, messageId) => set({ jump: { channelId, messageId, nonce: ++jumpNonce } }),
}));
