import { useEffect } from "react";
import { Link } from "react-router";
import { APP_NAME, type Channel } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { Nick } from "../components/Nick.tsx";
import { statusLine } from "../lib/look.ts";
import { useApp } from "../state/app.ts";
import { useUi } from "../state/ui.ts";
import { preloadVoice } from "../voice/controller.ts";

/** Início: quem está em call agora e quem está online. */
export function HomePage() {
  const me = useApp((s) => s.me || null);
  const users = useApp((s) => s.users);
  const online = useApp((s) => s.online);
  const channels = useApp((s) => s.channels);
  const voice = useApp((s) => s.voice);

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
        <header className="hero">
          <h1 className="hero-title">E aí, {me?.displayName}.</h1>
          <p className="hero-sub">{sub}</p>
        </header>

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
                <li key={u.id}>
                  <button type="button" className="person-card" onClick={() => useUi.getState().openProfile(u.id)}>
                    <Avatar user={u} size={44} online />
                    <span className="person-names">
                      <Nick user={u} className="person-name" />
                      <span className="person-sub">{statusLine(u, u.status)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-card">Quando alguém abrir o {APP_NAME}, aparece aqui.</p>
          )}
        </section>
      </div>
    </main>
  );
}

function LiveRoomCard({ channel }: { channel: Channel }) {
  const members = useApp((s) => s.voice[channel.id]) ?? [];
  const users = useApp((s) => s.users);
  const streamer = members.find((m) => m.streaming);

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
          <span className="mono-label">{APP_NAME}</span>
          <span className="live-card-name">{channel.name}</span>
        </span>
        <span className="live-card-meta">{members.length} na call</span>
      </span>
    </Link>
  );
}
