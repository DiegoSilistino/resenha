import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { PartyPopper } from "lucide-react";
import { APP_NAME, type Channel } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { Nick } from "../components/Nick.tsx";
import { api } from "../lib/api.ts";
import { statusLine } from "../lib/look.ts";
import { openConversationWith } from "../lib/social.ts";
import guarana from "../assets/mascote/guarana.webp";
import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";
import { useUi } from "../state/ui.ts";
import { preloadVoice } from "../voice/controller.ts";

/** Início: quem está em call agora e quem está online. */
export function HomePage() {
  const me = useApp((s) => s.me || null);
  const users = useApp((s) => s.users);
  const online = useApp((s) => s.online);
  const channels = useApp((s) => s.channels);
  const voice = useApp((s) => s.voice);
  const friends = useApp((s) => s.friends);
  const navigate = useNavigate();

  useEffect(() => {
    useUi.getState().setPageTitle(APP_NAME);
  }, []);

  const live = channels.filter((c) => c.kind === "voice" && (voice[c.id]?.length ?? 0) > 0);
  const screens = Object.values(voice).flat().filter((m) => m.streaming).length;
  const onlineNow = Object.values(users)
    .filter((u) => online[u.id] && u.id !== me?.id && !u.disabled && !u.removed)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));

  const sub = [
    onlineNow.length === 0 ? "Ninguém mais online agora" : `${onlineNow.length} ${onlineNow.length === 1 ? "pessoa online" : "pessoas online"}`,
    screens > 0 ? ` e ${screens} ${screens === 1 ? "tela" : "telas"} ao vivo agora` : "",
    ".",
  ].join("");

  return (
    <main className="page">
      <div className="page-inner">
        <header className="hero hero-row">
          <div className="hero-text">
            <h1 className="hero-title">E aí, {me?.displayName}.</h1>
            <p className="hero-sub">{sub}</p>
          </div>
          <span className="row-actions">
            <Link to="/amigos?aba=adicionar" className="btn btn-outline">
              Adicionar amigo
            </Link>
            <button type="button" className="btn btn-primary" onClick={() => useUi.getState().setNewRodaOpen(true)}>
              Nova roda
            </button>
          </span>
        </header>

        <NoticesCard />

        <section className="page-section" aria-labelledby="live-title">
          <div className="section-head">
            <h2 id="live-title" className="section-title">
              Rolando agora
            </h2>
            {live.length > 0 && (
              <span className="mono-label" data-tone="live">
                {live.length} {live.length === 1 ? "sala" : "salas"}
              </span>
            )}
          </div>
          {live.length > 0 ? (
            <div className="live-grid">
              {live.map((c) => (
                <LiveRoomCard key={c.id} channel={c} />
              ))}
            </div>
          ) : (
            <p className="empty-card">Ninguém em call agora. Abra uma sala e chame a galera.</p>
          )}
        </section>

        <div className="home-row">
        <section className="page-section" aria-labelledby="online-title">
          <div className="section-head">
            <h2 id="online-title" className="section-title">
              Online agora
            </h2>
            <span className="mono-label" data-tone="online">
              {onlineNow.length}
            </span>
          </div>
          {onlineNow.length > 0 ? (
            <ul className="online-grid">
              {onlineNow.map((u) => (
                <li key={u.id} className="person-card">
                  <button type="button" className="person-open" onClick={() => useUi.getState().openProfile(u.id)}>
                    <Avatar user={u} size={44} online />
                    <span className="person-names">
                      <Nick user={u} className="person-name" />
                      <span className="person-sub">{statusLine(u, u.status)}</span>
                    </span>
                  </button>
                  {friends[u.id]?.status === "friend" && (
                    <button type="button" className="btn btn-small" onClick={() => void openConversationWith([u.id], navigate)}>
                      Chamar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-card">Quando alguém abrir o {APP_NAME}, aparece aqui.</p>
          )}
        </section>
        <figure className="mascot-card">
          <img src={guarana} alt="" width={485} height={640} decoding="async" />
        </figure>
        </div>

        <FeedbackCard />
      </div>
    </main>
  );
}

/** Avisos guardados para você (ex.: sua sugestão foi implementada): ficam aqui até você dispensar. */
function NoticesCard() {
  const notices = useApp((s) => s.notices);
  if (notices.length === 0) return null;
  const dismiss = (id: number) => {
    useApp.getState().dismissNotice(id);
    void api.dismissNotice(id).catch(() => undefined); // se falhar, o aviso volta na próxima conexão
  };
  return (
    <section className="page-section" aria-labelledby="notices-title">
      <div className="section-head">
        <h2 id="notices-title" className="section-title">
          Novidades para você
        </h2>
      </div>
      <ul className="notice-list">
        {notices.map((n) => (
          <li key={n.id} className="card notice-card">
            <PartyPopper size={22} aria-hidden="true" />
            <p>{n.text}</p>
            <button type="button" className="btn btn-small btn-primary" onClick={() => dismiss(n.id)}>
              Valeu!
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const FEEDBACK_KINDS = ["Sugestão", "Problema", "Elogio"] as const;
const FEEDBACK_MAX = 1_000;

/** Feedback: vai direto para o painel do admin (Erros e feedback), com o aviso de novidade. */
function FeedbackCard() {
  const [kind, setKind] = useState<(typeof FEEDBACK_KINDS)[number]>("Sugestão");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e: FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    setBusy(true);
    try {
      await api.sendFeedback(`${kind}: ${message}`);
      setText("");
      toast.info("Valeu! Seu feedback chegou para quem administra o Resenha.");
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page-section" aria-labelledby="feedback-title">
      <div className="section-head">
        <h2 id="feedback-title" className="section-title">
          Feedback
        </h2>
      </div>
      <form className="card feedback-card form" onSubmit={send}>
        <p className="muted">Achou um problema ou tem uma ideia? Conta aqui: vai direto para quem administra o {APP_NAME}.</p>
        <div className="choice-row" role="group" aria-label="Tipo de feedback">
          {FEEDBACK_KINDS.map((k) => (
            <button key={k} type="button" className="choice" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k}
            </button>
          ))}
        </div>
        <textarea
          rows={3}
          maxLength={FEEDBACK_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={kind === "Problema" ? "O que aconteceu? O que você estava fazendo?" : "Escreva aqui…"}
          aria-label="Seu feedback"
        />
        <div className="feedback-foot">
          <small className="muted">
            {text.length}/{FEEDBACK_MAX}
          </small>
          <button className="btn btn-primary" disabled={busy || !text.trim()}>
            {busy ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </form>
    </section>
  );
}

function LiveRoomCard({ channel }: { channel: Channel }) {
  const members = useApp((s) => s.voice[channel.id]) ?? [];
  const users = useApp((s) => s.users);
  const streamer = members.find((m) => m.streaming);
  const rodaName = useApp((s) => (channel.rodaId ? s.rodas[channel.rodaId]?.name : undefined)) ?? "";

  return (
    <Link to={`/c/${channel.id}`} className="live-card" onPointerEnter={preloadVoice}>
      <span className="live-thumb" data-live={streamer ? true : undefined}>
        {streamer ? (
          <>
            <span className="live-chip">ao vivo</span>
            <span className="live-thumb-label mono-label">tela de {users[streamer.userId]?.displayName ?? "alguém"}</span>
          </>
        ) : (
          <span className="live-faces">
            {members.slice(0, 4).map((m) => (
              <Avatar key={m.userId} user={users[m.userId]} size={46} />
            ))}
          </span>
        )}
      </span>
      <span className="live-card-foot">
        <span className="live-card-names">
          <span className="mono-label">{rodaName}</span>
          <span className="live-card-name">{channel.name}</span>
        </span>
        <span className="live-card-meta">{members.length} na call</span>
      </span>
    </Link>
  );
}
