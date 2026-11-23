import { useEffect } from "react";
import { useSettings, type ChatWall, type ThemeAccent, type ThemeBg } from "../state/settings.ts";

/** Cores de destaque: mesmo brilho, matizes diferentes (o texto sobre elas segue o matiz). */
export const ACCENTS: Record<ThemeAccent, { label: string; h: number; c: number }> = {
  lima: { label: "Lima", h: 122, c: 0.19 },
  coral: { label: "Coral", h: 40, c: 0.14 },
  ceu: { label: "Céu", h: 230, c: 0.11 },
  lilas: { label: "Lilás", h: 300, c: 0.13 },
  rosa: { label: "Rosa", h: 355, c: 0.14 },
};
export const accentColor = (id: ThemeAccent) => `oklch(0.88 ${ACCENTS[id].c} ${ACCENTS[id].h})`;

/** Fundo da página, dos cartões e dos campos. */
export const BGS: Record<ThemeBg, { label: string; bg0: string; bg1: string; bg2: string }> = {
  carvao: { label: "Carvão", bg0: "#09090b", bg1: "#111113", bg2: "#17171a" },
  grafite: { label: "Grafite", bg0: "#151517", bg1: "#1c1c1f", bg2: "#232327" },
  noite: { label: "Meia-noite", bg0: "#070a12", bg1: "#0e121d", bg2: "#151a27" },
};

export const WALLS: Record<ChatWall, { label: string; css: string }> = {
  nenhum: { label: "Liso", css: "none" },
  listras: {
    label: "Listras",
    css: "repeating-linear-gradient(135deg, rgb(255 255 255 / 0.03) 0 14px, transparent 14px 28px)",
  },
  pontos: { label: "Pontos", css: "radial-gradient(rgb(255 255 255 / 0.09) 1px, transparent 1.6px) 0 0 / 18px 18px" },
};

/** Aplica a aparência escolhida nas variáveis do :root (o CSS inteiro lê delas). */
export function useTheme() {
  const accent = useSettings((s) => s.themeAccent);
  const bg = useSettings((s) => s.themeBg);
  const wall = useSettings((s) => s.chatWall);
  useEffect(() => {
    const root = document.documentElement.style;
    const a = ACCENTS[accent] ?? ACCENTS.lima;
    const b = BGS[bg] ?? BGS.carvao;
    root.setProperty("--accent", `oklch(0.88 ${a.c} ${a.h})`);
    root.setProperty("--accent-ink", `oklch(0.22 0.06 ${a.h})`);
    root.setProperty("--accent-soft", `oklch(0.27 0.05 ${a.h})`);
    root.setProperty("--backdrop", b.bg0);
    root.setProperty("--night", b.bg1);
    root.setProperty("--panel", b.bg2);
    root.setProperty("--well", b.bg2);
    root.setProperty("--chat-wall", (WALLS[wall] ?? WALLS.nenhum).css);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", b.bg0);
  }, [accent, bg, wall]);
}
