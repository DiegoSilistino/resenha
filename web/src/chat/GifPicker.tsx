import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Search, Star, TrendingUp } from "lucide-react";
import type { GifCategories, GifResult } from "@resenha/shared";
import { api } from "../lib/api.ts";
import { toggleGifFavorite, useSettings } from "../state/settings.ts";
import { placePopover, usePopoverDismiss } from "./popover.ts";

interface Props {
  anchor: HTMLElement;
  onPick(gif: GifResult): void;
  onClose(): void;
}

const WIDTH = 420;
const HEIGHT = 480;
/** Espera a pessoa parar de digitar: cada busca gasta uma das 100 chamadas/hora do GIPHY. */
const DEBOUNCE_MS = 450;

/** O que o painel mostra: os quadrinhos do início, os em alta, os favoritos ou uma busca. */
type View = { kind: "inicio" } | { kind: "alta" } | { kind: "favoritos" } | { kind: "busca"; q: string };

export function GifPicker({ anchor, onPick, onClose }: Props) {
  const width = Math.min(WIDTH, window.innerWidth - 16);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>({ kind: "inicio" });
  const [gifs, setGifs] = useState<GifResult[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("ready");
  const [error, setError] = useState("");
  const [more, setMore] = useState(true);
  const [cats, setCats] = useState<GifCategories | null>(null);
  const favorites = useSettings((s) => s.gifFavorites);
  const [pos, setPos] = useState(() => placePopover(anchor, width, HEIGHT));
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useLayoutEffect(() => setPos(placePopover(anchor, width, HEIGHT)), [anchor, width]);
  usePopoverDismiss(panel, anchor, onClose);

  useEffect(() => {
    api.gifCategories().then(setCats, () => setCats({ trending: null, categories: [] }));
  }, []);

  const load = useCallback(async (q: string, offset: number) => {
    const my = ++seq.current;
    setState("loading");
    if (offset === 0) setGifs([]);
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

  // Digitar vira busca depois de uma pausa (2+ letras); apagar tudo volta ao início.
  useEffect(() => {
    const q = query.trim();
    if (q.length === 1) return;
    if (!q) {
      setView((v) => (v.kind === "busca" ? { kind: "inicio" } : v));
      return;
    }
    const timer = setTimeout(() => setView((v) => (v.kind === "busca" && v.q === q ? v : { kind: "busca", q })), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (view.kind === "busca") void load(view.q, 0);
    else if (view.kind === "alta") void load("", 0);
  }, [view, load]);

  function back() {
    setQuery("");
    setView({ kind: "inicio" });
    input.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault(); // dentro de um <dialog>, o Esc fecharia o diálogo inteiro
      e.stopPropagation();
      onClose();
      anchor.focus();
    }
  }

  const list = view.kind === "favoritos" ? favorites : gifs;
  const favIds = new Set(favorites.map((f) => f.id));
  // duas colunas, cada GIF vai para a coluna mais baixa (grade "de tijolinhos")
  const columns: GifResult[][] = [[], []];
  const heights = [0, 0];
  for (const g of list) {
    const col = heights[0]! <= heights[1]! ? 0 : 1;
    columns[col]!.push(g);
    heights[col]! += g.height / g.width;
  }

  const placeholder = view.kind === "alta" ? "GIFs em alta" : view.kind === "favoritos" ? "Favoritos" : "Buscar no GIPHY";

  return createPortal(
    <div
      ref={panel}
      className="gif-picker"
      role="dialog"
      aria-label="Escolher GIF"
      style={{ top: pos.top, left: pos.left, width, height: HEIGHT }}
      onKeyDown={onKeyDown}
    >
      <div className="gif-search-row">
        {view.kind !== "inicio" && (
          <button type="button" className="icon-btn" aria-label="Voltar" title="Voltar" onClick={back}>
            <ArrowLeft size={18} />
          </button>
        )}
        <label className="emoji-search">
          <Search size={16} aria-hidden="true" />
          <input
            ref={input}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label="Buscar GIF"
          />
        </label>
      </div>
      <div className="gif-scroll">
        {view.kind === "inicio" ? (
          <div className="gif-tiles">
            <Tile label="Favoritos" icon={<Star size={16} />} gif={favorites[0] ?? null} tone="fav" onClick={() => setView({ kind: "favoritos" })} />
            <Tile label="GIFs em alta" icon={<TrendingUp size={16} />} gif={cats?.trending ?? null} onClick={() => setView({ kind: "alta" })} />
            {cats?.categories.map((c) => (
              <Tile
                key={c.term}
                label={c.term}
                gif={c.gif}
                onClick={() => {
                  setQuery(c.term);
                  setView({ kind: "busca", q: c.term });
                }}
              />
            ))}
          </div>
        ) : view.kind === "favoritos" && favorites.length === 0 ? (
          <p className="emoji-empty">Nenhum favorito ainda. Passe o mouse num GIF e toque na estrela.</p>
        ) : view.kind !== "favoritos" && state === "error" ? (
          <p className="emoji-empty">{error}</p>
        ) : list.length === 0 && state === "ready" ? (
          <p className="emoji-empty">Nenhum GIF para "{query.trim()}".</p>
        ) : (
          <div className="gif-grid">
            {columns.map((col, i) => (
              <div key={i} className="gif-col">
                {col.map((g) => (
                  <div key={g.id} className="gif-item">
                    <button type="button" className="gif-pick" onClick={() => onPick(g)} title={g.title} aria-label={g.title}>
                      <video src={g.previewUrl} autoPlay loop muted playsInline style={{ aspectRatio: `${g.width} / ${g.height}` }} />
                    </button>
                    <button
                      type="button"
                      className="gif-fav"
                      aria-pressed={favIds.has(g.id)}
                      aria-label={favIds.has(g.id) ? "Tirar dos favoritos" : "Favoritar"}
                      title={favIds.has(g.id) ? "Tirar dos favoritos" : "Favoritar"}
                      onClick={() => toggleGifFavorite(g)}
                    >
                      <Star size={16} fill={favIds.has(g.id) ? "currentColor" : "none"} />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {view.kind !== "inicio" && view.kind !== "favoritos" && state === "loading" && <p className="emoji-empty">Carregando…</p>}
        {view.kind !== "inicio" && view.kind !== "favoritos" && state === "ready" && more && gifs.length > 0 && (
          <div className="gif-more">
            <button type="button" className="btn btn-small" onClick={() => void load(view.kind === "busca" ? view.q : "", gifs.length)}>
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

/** Quadrinho da tela inicial: um GIF de fundo, escurecido, com o nome por cima (como no Discord). */
function Tile({ label, icon, gif, tone, onClick }: { label: string; icon?: ReactNode; gif: GifResult | null; tone?: "fav"; onClick(): void }) {
  return (
    <button type="button" className="gif-tile" data-tone={tone} onClick={onClick}>
      {gif && <video src={gif.previewUrl} autoPlay loop muted playsInline aria-hidden="true" />}
      <span className="gif-tile-label">
        {icon}
        {label}
      </span>
    </button>
  );
}
