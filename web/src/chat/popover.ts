import { useEffect, type RefObject } from "react";

/** Posição fixa na tela para um painel: abaixo do botão, ou acima se não couber; nunca para fora. */
export function placePopover(anchor: HTMLElement, width: number, height: number, gap = 6): { top: number; left: number } {
  const r = anchor.getBoundingClientRect();
  const below = r.bottom + gap + height <= window.innerHeight;
  const top = below ? r.bottom + gap : Math.max(8, r.top - gap - height);
  const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
  return { top, left: Math.max(8, left) };
}

/** Fecha ao clicar fora, ao rolar a conversa (o botão sairia do lugar) ou ao redimensionar. */
export function usePopoverDismiss(panel: RefObject<HTMLElement | null>, anchor: HTMLElement, onClose: () => void) {
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    const scroll = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [panel, anchor, onClose]);
}
