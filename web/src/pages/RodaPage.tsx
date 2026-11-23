import { useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { Settings2 } from "lucide-react";
import { APP_NAME, type Channel } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { plainText } from "../chat/plain.ts";
import { MemberList } from "../layout/MemberList.tsx";
import { useAdminBadge, VoiceBars } from "../layout/Sidebar.tsx";
import { displayNameOf, useApp } from "../state/app.ts";
import { useUi } from "../state/ui.ts";
import { joinVoice, preloadVoice, useVoice } from "../voice/controller.ts";

/** A página da roda: as salas de texto e de voz e quem faz parte. No celular é por aqui que se troca de sala. */
export function RodaPage() {
  const channels = useApp((s) => s.channels);
  const users = useApp((s) => s.users);
  const { isAdmin, newErrors } = useAdminBadge();

  useEffect(() => {
    useUi.getState().setPageTitle(APP_NAME);
  }, []);

  const text = channels.filter((c) => c.kind === "text");
  const voice = channels.filter((c) => c.kind === "voice");
  const members = Object.values(users).filter((u) => !u.disabled && !u.removed);

  return (
    <main className="page">
      <div className="page-inner page-inner-tight">
        <header className="roda-banner">
          <div className="roda-banner-top">
            <span className="roda-privacy">privada</span>
          </div>
          <h1 className="roda-title">{APP_NAME}</h1>
          <div className="roda-banner-foot">
            <span className="roda-faces">
              {members.slice(0, 5).map((u) => (
                <Avatar key={u.id} user={u} size={32} />
              ))}
            </span>
            <span className="roda-count">
              {members.length} {members.length === 1 ? "membro" : "membros"}
            </span>
            {isAdmin && (
              <span className="roda-actions">
                <button
                  type="button"
                  className="btn btn-on-banner admin-btn"
                  data-badge={newErrors || undefined}
                  onClick={() => useUi.getState().setAdminOpen(true)}
                  title={newErrors ? "Tem erro novo no painel" : undefined}
                >
                  <Settings2 size={16} aria-hidden="true" /> Ajustes
                </button>
                <button type="button" className="btn btn-ink" onClick={() => useUi.getState().setAdminOpen(true, "invites")}>
                  Convidar
                </button>
              </span>
            )}
          </div>
        </header>

        <div className="roda-columns">
          <div className="roda-rooms">
            <section className="page-section" aria-labelledby="text-rooms">
              <div className="section-head">
                <h2 id="text-rooms" className="section-title">
                  Salas de texto
                </h2>
                <span className="mono-label">{text.length}</span>
                {isAdmin && <AddRoom label="+ Texto" />}
              </div>
              <ul className="room-list card">
                {text.map((c) => (
                  <TextRoomRow key={c.id} channel={c} />
                ))}
              </ul>
            </section>

            <section className="page-section" aria-labelledby="voice-rooms">
              <div className="section-head">
                <h2 id="voice-rooms" className="section-title">
                  Salas de voz
                </h2>
                <span className="mono-label">{voice.length}</span>
                {isAdmin && <AddRoom label="+ Voz" />}
              </div>
              <div className="voice-cards">
                {voice.map((c) => (
                  <VoiceRoomCard key={c.id} channel={c} />
                ))}
              </div>
            </section>
          </div>
          <MemberList />
        </div>
      </div>
    </main>
  );
}

function AddRoom({ label }: { label: string }) {
  return (
    <button type="button" className="btn btn-small btn-outline section-action" onClick={() => useUi.getState().setAdminOpen(true, "channels")}>
      {label}
    </button>
  );
}

function TextRoomRow({ channel }: { channel: Channel }) {
  const last = useApp((s) => s.messages[channel.id]?.items.at(-1));
  const users = useApp((s) => s.users);
  const unread = useApp((s) => !!s.unread[channel.id]);
  const mentions = useApp((s) => s.mentions[channel.id] ?? 0);
  // Só tem prévia o canal já aberto nesta visita (as mensagens chegam quando você abre o canal).
  const preview = last ? `${displayNameOf(users, last.authorId)}: ${plainText(last.content) || "anexo"}` : null;

  return (
    <li>
      <Link to={`/c/${channel.id}`} className="room-row" data-unread={unread || undefined}>
        <span className="room-icon" aria-hidden="true">
          #
        </span>
        <span className="room-names">
          <span className="room-name">{channel.name}</span>
          {preview && <span className="room-preview">{preview}</span>}
        </span>
        {mentions > 0 ? (
          <span className="mention-badge" aria-label={`${mentions} ${mentions === 1 ? "menção" : "menções"} a você`}>
            {mentions > 99 ? "99+" : mentions}
          </span>
        ) : (
          unread && <span className="unread-dot" aria-label="mensagens novas" />
        )}
      </Link>
    </li>
  );
}

function VoiceRoomCard({ channel }: { channel: Channel }) {
  const members = useApp((s) => s.voice[channel.id]) ?? [];
  const users = useApp((s) => s.users);
  const here = useVoice((s) => s.channelId === channel.id && s.status !== "idle");
  const speaking = useVoice((s) => s.speaking);
  const navigate = useNavigate();
  const live = members.some((m) => m.streaming);

  return (
    <div className="voice-card card" data-here={here || undefined} onPointerEnter={preloadVoice}>
      <div className="voice-card-head">
        <VoiceBars on={members.length > 0} />
        <span className="voice-card-name">{channel.name}</span>
        {live && <span className="live-chip">ao vivo</span>}
      </div>
      {members.length > 0 ? (
        <ul className="voice-card-people">
          {members.map((m) => (
            <li key={m.userId}>
              <Avatar user={users[m.userId]} size={28} speaking={!!speaking[m.userId]} />
              <span className="voice-card-person">{users[m.userId]?.displayName ?? "…"}</span>
              {m.streaming && <span className="flag-live">tela</span>}
              {(m.muted || m.deafened) && <span className="mono-label">mudo</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="voice-card-empty">Vazia. Entre e chame a galera.</p>
      )}
      <button
        type="button"
        className={here ? "btn" : "btn btn-primary"}
        onClick={() => {
          navigate(`/c/${channel.id}`);
          if (!here) void joinVoice(channel.id);
        }}
      >
        {here ? "Abrir sala" : "Entrar"}
      </button>
    </div>
  );
}
