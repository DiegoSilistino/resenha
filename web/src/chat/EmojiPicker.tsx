import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { useSettings } from "../state/settings.ts";
import { EMOJI_CATEGORIES, emojiName, QUICK_REACTIONS, searchEmojis } from "./emojis.ts";

interface Props {
  /** Botão que abriu o seletor: a janela aparece colada nele. */
  anchor: HTMLElement;
  onPick(emoji: string): void;
  onClose(): void;
}

const WIDTH = 332;
const HEIGHT = 380;
const GAP = 6;

/** Posição fixa na tela: abaixo do botão, ou acima se não couber; nunca para fora da janela. */
function place(anchor: HTMLElement): { top: number; left: number } {
  const r = anchor.getBoundingClientRect();
  const below = r.bottom + GAP + HEIGHT <= window.innerHeight;
  const top = below ? r.bottom + GAP : Math.max(8, r.top - GAP - HEIGHT);
  const left = Math.min(Math.max(8, r.right - WIDTH), window.innerWidth - WIDTH - 8);
  return { top, left: Math.max(8, left) };
}

export function EmojiPicker({ anchor, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState(() => place(anchor));
  const panel = useRef<HTMLDivElement>(null);
  const recent = useSettings((s) => s.recentEmojis);

  useLayoutEffect(() => setPos(place(anchor)), [anchor]);

  // Fecha ao clicar fora, ao rolar a conversa (o botão sairia do lugar) ou ao redimensionar.
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
  }, [anchor, onClose]);

  const results = query.trim() ? searchEmojis(query) : null;
  // Recentes primeiro, completando com os clássicos para a primeira linha nunca ficar vazia.
  const quick = [...new Set([...recent, ...QUICK_REACTIONS])].slice(0, 8);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      anchor.focus();
    }
    if (e.key === "Enter" && results?.[0]) {
      e.preventDefault();
      onPick(results[0]);
    }
  }

  const button = (emoji: string) => (
    <button
      key={emoji}
      type="button"
      className="emoji-btn"
      onClick={() => onPick(emoji)}
      title={emojiName(emoji)}
      aria-label={emojiName(emoji)}
    >
      {emoji}
    </button>
  );

  return createPortal(
    <div
      ref={panel}
      className="emoji-picker"
      role="dialog"
      aria-label="Escolher emoji"
      style={{ top: pos.top, left: pos.left, width: WIDTH, height: HEIGHT }}
      onKeyDown={onKeyDown}
    >
      <label className="emoji-search">
        <Search size={16} aria-hidden="true" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar (ex.: risada, fogo, coração)"
          aria-label="Buscar emoji"
        />
      </label>
      <div className="emoji-scroll">
        {results ? (
          results.length > 0 ? (
            <div className="emoji-grid">{results.map(button)}</div>
          ) : (
            <p className="emoji-empty">Nenhum emoji com "{query.trim()}".</p>
          )
        ) : (
          <>
            <section>
              <h3 className="emoji-cat">Frequentes</h3>
              <div className="emoji-grid">{quick.map(button)}</div>
            </section>
            {EMOJI_CATEGORIES.map((cat) => (
              <section key={cat.id}>
                <h3 className="emoji-cat">{cat.label}</h3>
                <div className="emoji-grid">{cat.emojis.map(([e]) => button(e))}</div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
