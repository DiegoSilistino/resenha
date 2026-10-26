import { useEffect, useRef, useState } from "react";
import { Hash, Paperclip, Search, Volume2, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import type { SearchResult } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { api } from "../lib/api.ts";
import { formatDay, formatTime } from "../lib/format.ts";
import { displayNameOf, useApp } from "../state/app.ts";
import { useSettings } from "../state/settings.ts";
import { useUi } from "../state/ui.ts";
import { channelIdFromPath, parseSnippet } from "./snippet.ts";

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

type Scope = "here" | "all";

interface Results {
  query: string;
  scope: Scope;
  channelId: string | null;
  items: SearchResult[];
  hasMore: boolean;
}

/** Os termos da busca ficam guardados ao fechar e reabrir o painel (até recarregar a página). */
let lastQuery = "";
let lastScope: Scope = "all";

export function SearchPanel() {
  const [query, setQuery] = useState(lastQuery);
  const [scope, setScope] = useState<Scope>(lastScope);
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const location = useLocation();
  const navigate = useNavigate();
  const here = channelIdFromPath(location.pathname);
  const hereChannel = useApp((s) => s.channels.find((c) => c.id === here));
  const channels = useApp((s) => s.channels);
  const users = useApp((s) => s.users);

  const close = () => useUi.getState().setSearchOpen(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  useEffect(() => {
    lastQuery = query;
    lastScope = scope;
  }, [query, scope]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // "Neste canal" segue o canal que está aberto: trocar de canal refaz a busca.
  const channelId = scope === "here" ? here : null;
  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < MIN_CHARS) {
      seq.current++;
      setResults(null);
      setLoading(false);
      setError(null);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .search(trimmed, channelId ? { channelId } : {})
        .then((r) => {
          if (mine !== seq.current) return;
          setResults({ query: trimmed, scope, channelId, items: r.results, hasMore: r.hasMore });
          setError(null);
        })
        .catch((err: Error) => {
          if (mine === seq.current) setError(err.message);
        })
        .finally(() => {
          if (mine === seq.current) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, channelId, scope]);

  function loadMore() {
    if (!results || loading) return;
    const before = results.items.at(-1)?.message.id;
    const mine = ++seq.current;
    setLoading(true);
    api
      .search(results.query, { ...(results.channelId ? { channelId: results.channelId } : {}), before })
      .then((r) => {
        if (mine !== seq.current) return;
        setResults({ ...results, items: [...results.items, ...r.results], hasMore: r.hasMore });
      })
      .catch((err: Error) => {
        if (mine === seq.current) setError(err.message);
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }

  function open(r: SearchResult) {
    const channel = channels.find((c) => c.id === r.message.channelId);
    if (!channel) return;
    // No canal de voz, a conversa fica no painel de chat da chamada: abre ele.
    if (channel.kind === "voice") useSettings.getState().set({ voiceChatOpen: true });
    if (here !== channel.id) void navigate(`/c/${channel.id}`, { state: { openChat: true } });
    useUi.getState().jumpTo(channel.id, r.message.id);
    // Em tela estreita o painel cobre a conversa: fecha para mostrar a mensagem.
    if (window.matchMedia("(max-width: 760px)").matches) close();
  }

  const showChannel = scope === "all";
  const hereLabel = hereChannel ? (hereChannel.kind === "voice" ? hereChannel.name : `#${hereChannel.name}`) : "este canal";

  return (
    <aside className="search-panel" aria-label="Buscar mensagens">
      <header className="search-head">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <input
            ref={input}
            type="search"
            value={query}
            maxLength={100}
            placeholder="Buscar mensagens"
            aria-label="Buscar mensagens"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                if (query) setQuery("");
                else close();
              }
            }}
          />
        </label>
        <button type="button" className="icon-btn" onClick={close} aria-label="Fechar a busca" title="Fechar (Esc)">
          <X size={18} />
        </button>
      </header>
      <div className="search-scope" role="radiogroup" aria-label="Onde buscar">
        <button type="button" role="radio" aria-checked={scope === "all"} onClick={() => setScope("all")}>
          Em todos os canais
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={scope === "here"}
          disabled={!here}
          onClick={() => setScope("here")}
        >
          Só em {hereLabel}
        </button>
      </div>

      <div className="search-results" aria-live="polite" aria-busy={loading}>
        {trimmed.length < MIN_CHARS ? (
          <p className="search-hint muted">
            Digite pelo menos {MIN_CHARS} letras. Acentos não importam e palavras pela metade também valem: “churras” acha
            “churrasco”.
          </p>
        ) : error ? (
          <p className="search-hint" role="alert">
            {error}
          </p>
        ) : !results ? (
          <p className="search-hint muted">Buscando…</p>
        ) : results.items.length === 0 ? (
          <p className="search-hint muted">Nada encontrado para “{results.query}”.</p>
        ) : (
          <>
            <p className="search-count muted">
              {results.hasMore ? `Mais de ${results.items.length}` : results.items.length}{" "}
              {results.items.length === 1 ? "resultado" : "resultados"}
            </p>
            <ul className="search-list">
              {results.items.map((r) => {
                const channel = channels.find((c) => c.id === r.message.channelId);
                const author = r.message.authorId;
                return (
                  <li key={r.message.id}>
                    <button type="button" className="search-hit" onClick={() => open(r)}>
                      {showChannel && channel && (
                        <span className="search-channel">
                          {channel.kind === "voice" ? (
                            <Volume2 size={12} aria-hidden="true" />
                          ) : (
                            <Hash size={12} aria-hidden="true" />
                          )}
                          {channel.name}
                        </span>
                      )}
                      <span className="search-meta">
                        <Avatar user={users[author]} size={20} />
                        <strong>{displayNameOf(users, author)}</strong>
                        <time className="muted" dateTime={new Date(r.message.createdAt).toISOString()}>
                          {formatDay(r.message.createdAt)} às {formatTime(r.message.createdAt)}
                        </time>
                      </span>
                      <span className="search-snippet">
                        {parseSnippet(r.snippet).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : p.text))}
                      </span>
                      {r.message.attachments.length > 0 && (
                        <span className="search-attach muted">
                          <Paperclip size={12} aria-hidden="true" />
                          {r.message.attachments.length === 1 ? "1 anexo" : `${r.message.attachments.length} anexos`}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {results.hasMore && (
              <button type="button" className="btn btn-small btn-ghost search-more" disabled={loading} onClick={loadMore}>
                {loading ? "Carregando…" : "Carregar mais"}
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
