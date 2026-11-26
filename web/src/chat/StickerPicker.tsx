import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { placePopover, usePopoverDismiss } from "./popover.ts";
import { STICKERS, type Sticker } from "./stickers.ts";

/** Quatro por linha, em quadradinhos de 76 px (encolhem no celular). */
const WIDTH = 342;
const HEIGHT = 180;

/** Figurinhas do caramelo: um clique e já vai, como o GIF. */
export function StickerPicker({ anchor, onPick, onClose }: { anchor: HTMLElement; onPick(sticker: Sticker): void; onClose(): void }) {
  const width = Math.min(WIDTH, window.innerWidth - 16);
  const [pos, setPos] = useState(() => placePopover(anchor, width, HEIGHT));
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => setPos(placePopover(anchor, width, HEIGHT)), [anchor, width]);
  usePopoverDismiss(panel, anchor, onClose);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault(); // dentro de um <dialog>, o Esc fecharia o diálogo inteiro
      e.stopPropagation();
      onClose();
      anchor.focus();
    }
  }

  return createPortal(
    <div
      ref={panel}
      className="gif-picker sticker-grid"
      role="dialog"
      aria-label="Escolher figurinha"
      style={{ top: pos.top, left: pos.left, width }}
      onKeyDown={onKeyDown}
    >
      {STICKERS.map((s, i) => (
        <button key={s.id} type="button" className="sticker-pick" autoFocus={i === 0} onClick={() => onPick(s)} title={s.name} aria-label={s.name}>
          <img src={s.src} alt="" />
        </button>
      ))}
    </div>,
    // dentro de um modal (<dialog> na camada do topo) o painel precisa ir junto, senão fica por baixo
    anchor.closest("dialog") ?? document.body,
  );
}
