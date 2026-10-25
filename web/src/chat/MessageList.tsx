import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type { Channel, Message } from "@resenha/shared";
import { api } from "../lib/api.ts";
import { formatDay, sameDay } from "../lib/format.ts";
import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";
import { useUi } from "../state/ui.ts";
import { MessageItem } from "./MessageItem.tsx";

/** Mensagens do mesmo autor, em até 7 minutos, ficam agrupadas sem repetir nome e avatar. */
const GROUP_WINDOW_MS = 7 * 60 * 1000;
const NEAR_BOTTOM_PX = 120;

export function MessageList({ channel }: { channel: Channel }) {
  const state = useApp((s) => s.messages[channel.id]);
  const meId = useApp((s) => (s.me ? s.me.id : null));
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prependAnchor = useRef<{ height: number; top: number } | null>(null);
  const [showJump, setShowJump] = useState(false);

  const items = state?.items ?? [];
  const lastId = items.at(-1)?.id;

  // Primeira carga do canal.
  useEffect(() => {
    const s = useApp.getState().messages[channel.id];
    if (s?.loaded || s?.loading) return;
    useApp.getState().setMessages(channel.id, { loading: true });
    api
      .messages(channel.id)
      .then((r) => useApp.getState().setMessages(channel.id, { items: r.messages, hasMore: r.hasMore, loaded: true, loading: false }))
      .catch((err) => {
        useApp.getState().setMessages(channel.id, { loading: false });
        toast.fromError(err, "Não foi possível carregar as mensagens");
      });
  }, [channel.id, state?.loaded]);

  const loadOlder = useCallback((): Promise<void> => {
    const s = useApp.getState().messages[channel.id];
    const el = scroller.current;
    if (!s?.loaded || s.loading || !s.hasMore || !el) return Promise.resolve();
    const oldest = s.items[0]?.id;
    if (!oldest) return Promise.resolve();
    useApp.getState().setMessages(channel.id, { loading: true });
    prependAnchor.current = { height: el.scrollHeight, top: el.scrollTop };
    return api
      .messages(channel.id, oldest)
      .then((r) => useApp.getState().prependMessages(channel.id, r.messages, r.hasMore))
      .catch((err) => {
        prependAnchor.current = null;
        useApp.getState().setMessages(channel.id, { loading: false });
        toast.fromError(err);
      });
  }, [channel.id]);

  // Clique numa citação: rola até a original, buscando páginas antigas se preciso, e a destaca.
  const jump = useUi((s) => (s.jump?.channelId === channel.id ? s.jump : null));
  useEffect(() => {
    if (!jump) return;
    let cancelled = false;
    void (async () => {
      for (let page = 0; page < 20 && !cancelled; page++) {
        const el = document.getElementById(`msg-${jump.messageId}`);
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          el.dataset.flash = "true";
          setTimeout(() => delete el.dataset.flash, 1_800);
          return;
        }
        const s = useApp.getState().messages[channel.id];
        if (!s?.loaded) await new Promise((r) => setTimeout(r, 150)); // primeira página ainda chegando
        else if (!s.hasMore) break;
        else {
          await loadOlder();
          await new Promise((r) => requestAnimationFrame(() => r(null)));
        }
      }
      if (!cancelled) toast.info("Não achei a mensagem original nesta conversa.");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.nonce]);

  const scrollToBottom = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setShowJump(false);
  }, []);

  // Depois de renderizar: mantém a posição ao carregar antigas, ou cola no fim.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prependAnchor.current) {
      const a = prependAnchor.current;
      el.scrollTop = el.scrollHeight - a.height + a.top;
      prependAnchor.current = null;
      return;
    }
    const lastIsMine = items.at(-1)?.authorId === meId;
    if (atBottom.current || lastIsMine) scrollToBottom();
    else if (items.length) setShowJump(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, items.length]);

  // Imagens que terminam de carregar mudam a altura: se estava no fim, continua no fim.
  useEffect(() => {
    const el = content.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (atBottom.current) setShowJump(false);
    if (el.scrollTop < 300) void loadOlder();
  };

  return (
    <div className="messages-wrap">
      <div className="messages" ref={scroller} onScroll={onScroll} role="log" aria-live="polite" aria-label={`Mensagens em ${channel.name}`}>
        <div ref={content} className="messages-inner">
          {state?.loaded && !state.hasMore && (
            <div className="channel-start">
              {channel.kind === "voice" ? (
                <>
                  <h2>Chat de {channel.name}</h2>
                  <p>Para mandar link, print ou GIF durante a call. Fica salvo como num canal de texto.</p>
                </>
              ) : (
                <>
                  <h2>Bem-vindo a #{channel.name}</h2>
                  <p>Este é o começo do canal.</p>
                </>
              )}
            </div>
          )}
          {state?.loading && <p className="messages-loading">Carregando mensagens…</p>}
          {items.map((m, i) => {
            const prev = items[i - 1];
            const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="day-divider" role="separator">
                    <span>{formatDay(m.createdAt)}</span>
                  </div>
                )}
                <MessageItem message={m} grouped={!newDay && isGrouped(prev, m)} />
              </div>
            );
          })}
        </div>
      </div>
      {showJump && (
        <button type="button" className="jump-latest" onClick={scrollToBottom}>
          <ArrowDown size={16} aria-hidden="true" /> Novas mensagens
        </button>
      )}
    </div>
  );
}

function isGrouped(prev: Message | undefined, m: Message): boolean {
  // resposta sempre mostra nome e avatar (a citação fica acima deles)
  return !!prev && !m.replyTo && prev.authorId === m.authorId && m.createdAt - prev.createdAt < GROUP_WINDOW_MS;
}
