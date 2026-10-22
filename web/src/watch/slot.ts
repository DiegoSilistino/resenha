import { create } from "zustand";

/**
 * O player do YouTube é montado UMA vez no app (trocar o iframe de lugar no DOM
 * recarregaria o vídeo). A tela do canal de voz registra aqui uma "vaga" onde
 * o player deve aparecer grande; sem vaga, ele vira um mini player flutuante.
 */
interface SlotState {
  slot: HTMLElement | null;
  setSlot(el: HTMLElement | null): void;
}

export const useWatchSlot = create<SlotState>()((set) => ({
  slot: null,
  setSlot: (slot) => set({ slot }),
}));
