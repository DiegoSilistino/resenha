import { create } from "zustand";

/** Pedido para rolar a conversa até uma mensagem (clique numa citação ou num resultado da busca). */
export interface JumpRequest {
  channelId: string;
  messageId: number;
  /** Muda a cada pedido, para clicar duas vezes na mesma citação funcionar. */
  nonce: number;
}

/** Abas do painel do admin (a ordem e os nomes ficam no AdminModal). */
export type AdminTab = "invites" | "channels" | "members" | "backup" | "errors";

interface UiState {
  settingsOpen: boolean;
  adminOpen: boolean;
  /** Aba pedida ao abrir o painel (ex.: "+ Texto" abre direto em Canais). */
  adminTab: AdminTab | null;
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
  setSettingsOpen(open: boolean): void;
  setAdminOpen(open: boolean, tab?: AdminTab): void;
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
  shareDialogOpen: false,
  searchOpen: false,
  pageTitle: "Resenha",
  replying: {},
  editingId: null,
  jump: null,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setAdminOpen: (adminOpen, tab) => set({ adminOpen, adminTab: tab ?? null }),
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
