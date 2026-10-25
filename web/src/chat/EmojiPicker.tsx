import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { useSettings } from "../state/settings.ts";
import { EMOJI_CATEGORIES, emojiName, QUICK_REACTIONS, searchEmojis } from "./emojis.ts";
import { placePopover, usePopoverDismiss } from "./popover.ts";

interface Props {
  /** Botão que abriu o seletor: a janela aparece colada nele. */
  anchor: HTMLElement;
  onPick(emoji: string): void;
  onClose(): void;
}

const WIDTH = 332;
const HEIGHT = 380;
const place = (anchor: HTMLElement) => placePopover(anchor, WIDTH, HEIGHT);

export function EmojiPicker({ anchor, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState(() => place(anchor));
  const panel = useRef<HTMLDivElement>(null);
  const recent = useSettings((s) => s.recentEmojis);

  useLayoutEffect(() => setPos(place(anchor)), [anchor]);

  usePopoverDismiss(panel, anchor, onClose);

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
