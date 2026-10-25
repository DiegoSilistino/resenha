import { create } from "zustand";

/** Pedido para rolar a conversa até uma mensagem (clique numa citação). */
export interface JumpRequest {
  channelId: string;
  messageId: number;
  /** Muda a cada pedido, para clicar duas vezes na mesma citação funcionar. */
  nonce: number;
}

interface UiState {
  navOpen: boolean;
  settingsOpen: boolean;
  adminOpen: boolean;
  shareDialogOpen: boolean;
  /** Título da página atual (o contador de não lidas é somado na frente). */
  pageTitle: string;
  /** canal -> mensagem que está sendo respondida no compositor */
  replying: Record<string, number>;
  /** Mensagem aberta para edição (só uma por vez, como no Discord). */
  editingId: number | null;
  jump: JumpRequest | null;
  setNavOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setAdminOpen(open: boolean): void;
  setShareDialogOpen(open: boolean): void;
  setPageTitle(title: string): void;
  setReplying(channelId: string, messageId: number | null): void;
  setEditing(id: number | null): void;
  jumpTo(channelId: string, messageId: number): void;
}

let jumpNonce = 0;

export const useUi = create<UiState>()((set) => ({
  navOpen: false,
  settingsOpen: false,
  adminOpen: false,
  shareDialogOpen: false,
  pageTitle: "Resenha",
  replying: {},
  editingId: null,
  jump: null,
  setNavOpen: (navOpen) => set({ navOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setAdminOpen: (adminOpen) => set({ adminOpen }),
  setShareDialogOpen: (shareDialogOpen) => set({ shareDialogOpen }),
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
