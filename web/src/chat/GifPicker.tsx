import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import type { GifResult } from "@resenha/shared";
import { api } from "../lib/api.ts";
import { placePopover, usePopoverDismiss } from "./popover.ts";

interface Props {
  anchor: HTMLElement;
  onPick(gif: GifResult): void;
  onClose(): void;
}

const WIDTH = 384;
const HEIGHT = 460;
/** Espera a pessoa parar de digitar: cada busca gasta uma das 100 chamadas/hora do GIPHY. */
const DEBOUNCE_MS = 450;

export function GifPicker({ anchor, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<GifResult[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [more, setMore] = useState(true);
  const [pos, setPos] = useState(() => placePopover(anchor, WIDTH, HEIGHT));
  const panel = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useLayoutEffect(() => setPos(placePopover(anchor, WIDTH, HEIGHT)), [anchor]);
  usePopoverDismiss(panel, anchor, onClose);

  const load = useCallback(async (q: string, offset: number) => {
    const my = ++seq.current;
    setState("loading");
    try {
      const { gifs: page } = await api.gifs(q, offset);
      if (my !== seq.current) return;
      setGifs((prev) => (offset === 0 ? page : [...prev, ...page.filter((g) => !prev.some((p) => p.id === g.id))]));
      setMore(page.length > 0);
      setState("ready");
    } catch (err) {
      if (my !== seq.current) return;
      setError(err instanceof Error ? err.message : "Não foi possível buscar GIFs.");
      setState("error");
    }
  }, []);

  // Em alta ao abrir; busca depois de uma pausa na digitação (2+ letras).
  useEffect(() => {
    const q = query.trim();
    if (q.length === 1) return;
    const timer = setTimeout(() => void load(q, 0), q ? DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [query, load]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault(); // dentro de um <dialog>, o Esc fecharia o diálogo inteiro
      e.stopPropagation();
      onClose();
      anchor.focus();
    }
  }

  // duas colunas, cada GIF vai para a coluna mais baixa (grade "de tijolinhos")
  const columns: GifResult[][] = [[], []];
  const heights = [0, 0];
  for (const g of gifs) {
    const col = heights[0]! <= heights[1]! ? 0 : 1;
    columns[col]!.push(g);
    heights[col]! += g.height / g.width;
  }

  return createPortal(
    <div
      ref={panel}
      className="gif-picker"
      role="dialog"
      aria-label="Escolher GIF"
      style={{ top: pos.top, left: pos.left, width: WIDTH, height: HEIGHT }}
      onKeyDown={onKeyDown}
    >
      <label className="emoji-search">
        <Search size={16} aria-hidden="true" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar GIFs (ex.: risada, gol, sextou)"
          aria-label="Buscar GIF"
        />
      </label>
      <div className="gif-scroll">
        {state === "error" ? (
          <p className="emoji-empty">{error}</p>
        ) : gifs.length === 0 && state === "ready" ? (
          <p className="emoji-empty">Nenhum GIF para "{query.trim()}".</p>
        ) : (
          <div className="gif-grid">
            {columns.map((col, i) => (
              <div key={i} className="gif-col">
                {col.map((g) => (
                  <button key={g.id} type="button" className="gif-item" onClick={() => onPick(g)} title={g.title}>
                    <img src={g.previewUrl} alt={g.title} loading="lazy" style={{ aspectRatio: `${g.width} / ${g.height}` }} />
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        {state === "loading" && <p className="emoji-empty">Carregando…</p>}
        {state === "ready" && more && gifs.length > 0 && (
          <div className="gif-more">
            <button type="button" className="btn btn-small" onClick={() => void load(query.trim(), gifs.length)}>
              Mais GIFs
            </button>
          </div>
        )}
      </div>
      <p className="gif-attribution">Powered by GIPHY</p>
    </div>,
    // dentro de um modal (<dialog> na camada do topo) o painel precisa ir junto, senão fica por baixo
    anchor.closest("dialog") ?? document.body,
  );
}
