import { useEffect } from "react";
import { Link, useNavigate } from "react-router";
import type { Roda, RodaSummary } from "@resenha/shared";
import { RodaBadge } from "../layout/Sidebar.tsx";
import { api } from "../lib/api.ts";
import { waitForRoda } from "../lib/rodas.ts";
import { bannerImageStyle } from "../lib/look.ts";
import { rodaColor, useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";
import { useUi } from "../state/ui.ts";

/** Rodas: as suas (com quem está em call e mensagens novas) e as abertas para entrar. */
export function RodasPage() {
  const rodas = useApp((s) => s.rodas);
  const open = useApp((s) => s.openRodas);
  const mine = Object.values(rodas).sort((a, b) => a.createdAt - b.createdAt);
  // quem acabou de entrar numa aberta ainda aparece na lista até o próximo "hello"
  const toJoin = open.filter((r) => !rodas[r.id]);

  useEffect(() => {
    useUi.getState().setPageTitle("Rodas");
  }, []);

  return (
    <main className="page">
      <div className="page-inner">
        <header className="hero hero-row">
          <div className="hero-text">
            <h1 className="hero-title friends-title">Rodas</h1>
            <p className="hero-sub">Cada roda é um grupo com as salas dele: amigos, estudo, jogo.</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => useUi.getState().setNewRodaOpen(true)}>
            Nova roda
          </button>
        </header>

        <section className="page-section" aria-labelledby="mine-title">
          <div className="section-head">
            <h2 id="mine-title" className="section-title">
              Suas rodas
            </h2>
            <span className="mono-label">{mine.length}</span>
          </div>
          {mine.length > 0 ? (
            <div className="roda-grid">
              {mine.map((r) => (
                <RodaCard key={r.id} roda={r} />
              ))}
            </div>
          ) : (
            <p className="empty-card">Você ainda não está em nenhuma roda. Crie uma ou peça um convite.</p>
          )}
        </section>

        {toJoin.length > 0 && (
          <section className="page-section" aria-labelledby="open-title">
            <div className="section-head">
              <h2 id="open-title" className="section-title">
                Abertas para entrar
              </h2>
              <span className="mono-label">{toJoin.length}</span>
            </div>
            <div className="roda-grid">
              {toJoin.map((r) => (
                <OpenRodaCard key={r.id} roda={r} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function RodaCard({ roda }: { roda: Roda }) {
  const channels = useApp((s) => s.channels).filter((c) => c.rodaId === roda.id);
  const voice = useApp((s) => s.voice);
  const unreadMap = useApp((s) => s.unread);
  const inCall = channels.reduce((n, c) => n + (voice[c.id]?.length ?? 0), 0);
  const unread = channels.filter((c) => c.kind === "text" && (unreadMap[c.id] ?? 0) > 0).length;
  const meta = [
    `${Object.keys(roda.members).length} membros`,
    inCall ? `${inCall} na call` : "",
    unread ? `${unread} ${unread === 1 ? "sala nova" : "salas novas"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link
      to={`/r/${roda.id}`}
      className="roda-card"
      data-image={roda.bannerUrl ? true : undefined}
      style={{ "--roda": rodaColor(roda.hue) } as React.CSSProperties}
    >
      {roda.bannerUrl && <img className="roda-card-img" src={roda.bannerUrl} alt="" style={bannerImageStyle(roda)} />}
      <span className="roda-card-top">
        <RodaBadge roda={roda} size={44} />
        <span className="roda-privacy">{roda.privacy === "aberta" ? "aberta" : "privada"}</span>
      </span>
      <span className="roda-card-name">{roda.name}</span>
      {roda.description && <span className="roda-card-desc">{roda.description}</span>}
      <span className="mono-label">{meta}</span>
    </Link>
  );
}

function OpenRodaCard({ roda }: { roda: RodaSummary }) {
  const navigate = useNavigate();
  async function join() {
    try {
      await api.joinRoda(roda.id);
      await waitForRoda(roda.id);
      void navigate(`/r/${roda.id}`);
    } catch (err) {
      toast.fromError(err);
    }
  }
  return (
    <div className="roda-card" style={{ "--roda": rodaColor(roda.hue) } as React.CSSProperties}>
      <span className="roda-card-top">
        <RodaBadge roda={roda} size={44} />
        <span className="roda-privacy">aberta</span>
      </span>
      <span className="roda-card-name">{roda.name}</span>
      {roda.description && <span className="roda-card-desc">{roda.description}</span>}
      <span className="roda-card-foot">
        <span className="mono-label">{roda.memberCount} membros</span>
        <button type="button" className="btn btn-small btn-primary" onClick={() => void join()}>
          Entrar
        </button>
      </span>
    </div>
  );
}
