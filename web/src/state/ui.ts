import { create } from "zustand";

interface UiState {
  navOpen: boolean;
  settingsOpen: boolean;
  adminOpen: boolean;
  shareDialogOpen: boolean;
  /** Título da página atual (o contador de não lidas é somado na frente). */
  pageTitle: string;
  setNavOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setAdminOpen(open: boolean): void;
  setShareDialogOpen(open: boolean): void;
  setPageTitle(title: string): void;
}

export const useUi = create<UiState>()((set) => ({
  navOpen: false,
  settingsOpen: false,
  adminOpen: false,
  shareDialogOpen: false,
  pageTitle: "Resenha",
  setNavOpen: (navOpen) => set({ navOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setAdminOpen: (adminOpen) => set({ adminOpen }),
  setShareDialogOpen: (shareDialogOpen) => set({ shareDialogOpen }),
  setPageTitle: (pageTitle) => set({ pageTitle }),
}));
