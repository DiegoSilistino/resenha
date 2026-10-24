import { create } from "zustand";

interface UiState {
  navOpen: boolean;
  settingsOpen: boolean;
  adminOpen: boolean;
  shareDialogOpen: boolean;
  setNavOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setAdminOpen(open: boolean): void;
  setShareDialogOpen(open: boolean): void;
}

export const useUi = create<UiState>()((set) => ({
  navOpen: false,
  settingsOpen: false,
  adminOpen: false,
  shareDialogOpen: false,
  setNavOpen: (navOpen) => set({ navOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setAdminOpen: (adminOpen) => set({ adminOpen }),
  setShareDialogOpen: (shareDialogOpen) => set({ shareDialogOpen }),
}));
