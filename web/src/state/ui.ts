import { create } from "zustand";

interface UiState {
  navOpen: boolean;
  settingsOpen: boolean;
  adminOpen: boolean;
  setNavOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setAdminOpen(open: boolean): void;
}

export const useUi = create<UiState>()((set) => ({
  navOpen: false,
  settingsOpen: false,
  adminOpen: false,
  setNavOpen: (navOpen) => set({ navOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setAdminOpen: (adminOpen) => set({ adminOpen }),
}));
