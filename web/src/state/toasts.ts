import { create } from "zustand";

export interface Toast {
  id: number;
  level: "info" | "error";
  text: string;
}

interface ToastState {
  toasts: Toast[];
  push(level: Toast["level"], text: string): void;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push(level, text) {
    // evita empilhar a mesma mensagem várias vezes seguidas
    if (get().toasts.some((t) => t.text === text)) return;
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, level, text }] }));
    setTimeout(() => get().dismiss(id), level === "error" ? 7_000 : 4_000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  info: (text: string) => useToasts.getState().push("info", text),
  error: (text: string) => useToasts.getState().push("error", text),
  fromError: (err: unknown, fallback = "Algo deu errado") =>
    useToasts.getState().push("error", err instanceof Error && err.message ? err.message : fallback),
};
