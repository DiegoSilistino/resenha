import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Plus, Star } from "lucide-react";
import { useApp } from "../state/app.ts";
import { placePopover, usePopoverDismiss } from "./popover.ts";
import { customSticker, STICKERS, toggleStickerFavorite, type Sticker } from "./stickers.ts";

/** Quatro por linha, em quadradinhos de 76 px (encolhem no celular); rola quando há muitas. */
const WIDTH = 342;
const HEIGHT = 360;

/** Suas figurinhas (criadas e favoritadas) e as do caramelo: um clique e já vai, como o GIF. */
export function StickerPicker({
  anchor,
  onPick,
  onCreate,
  onClose,
}: {
  anchor: HTMLElement;
  onPick(sticker: Sticker): void;
  onCreate(): void;
  onClose(): void;
}) {
  const mine = useApp((s) => s.stickers);
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
      className="gif-picker"
      role="dialog"
      aria-label="Escolher figurinha"
      style={{ top: pos.top, left: pos.left, width, height: HEIGHT }}
      onKeyDown={onKeyDown}
    >
      <div className="sticker-scroll">
        <h3 className="sticker-section">Suas figurinhas</h3>
        {mine.length === 0 && <p className="sticker-hint">Crie uma com uma foto, ou toque na estrela de uma figurinha na conversa para guardar.</p>}
        <div className="sticker-grid">
          <button type="button" className="sticker-pick sticker-new" autoFocus onClick={onCreate} title="Criar figurinha com uma foto" aria-label="Criar figurinha">
            <Plus size={26} aria-hidden="true" />
          </button>
          {mine.map((id) => {
            const s = customSticker(id);
            return (
              <div key={id} className="sticker-item">
                <button type="button" className="sticker-pick" onClick={() => onPick(s)} aria-label="Enviar figurinha">
                  <img src={s.src} alt="" loading="lazy" />
                </button>
                <button
                  type="button"
                  className="gif-fav"
                  aria-pressed
                  aria-label="Tirar das suas figurinhas"
                  title="Tirar das suas figurinhas"
                  onClick={() => void toggleStickerFavorite(id)}
                >
                  <Star size={14} fill="currentColor" />
                </button>
              </div>
            );
          })}
        </div>
        <h3 className="sticker-section">Caramelo</h3>
        <div className="sticker-grid">
          {STICKERS.map((s) => (
            <button key={s.id} type="button" className="sticker-pick" onClick={() => onPick(s)} title={s.name} aria-label={s.name}>
              <img src={s.src} alt="" />
            </button>
          ))}
        </div>
      </div>
    </div>,
    // dentro de um modal (<dialog> na camada do topo) o painel precisa ir junto, senão fica por baixo
    anchor.closest("dialog") ?? document.body,
  );
}
