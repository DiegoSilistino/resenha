import { useEffect } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { Settings2 } from "lucide-react";
import type { Channel } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { plainText } from "../chat/plain.ts";
import { MemberList } from "../layout/MemberList.tsx";
import { canManageRoda, VoiceBars } from "../layout/Sidebar.tsx";
import { api } from "../lib/api.ts";
import { bannerImageStyle } from "../lib/look.ts";
import { displayNameOf, isRodaOwner, rodaColor, rodaPerms, useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";
import { useUi } from "../state/ui.ts";
import { joinVoice, preloadVoice, useVoice } from "../voice/controller.ts";

/** A página da roda: as salas de texto e de voz e quem faz parte. No celular é por aqui que se troca de sala. */
export function RodaPage() {
  const { rodaId = "" } = useParams();
  const roda = useApp((s) => s.rodas[rodaId]);
  const me = useApp((s) => s.me);
  const channels = useApp((s) => s.channels).filter((c) => c.rodaId === rodaId);
  const users = useApp((s) => s.users);
  const navigate = useNavigate();

  useEffect(() => {
    if (roda) useUi.getState().setPageTitle(roda.name);
  }, [roda?.name]);

  // saiu, foi tirado ou a roda acabou: volta para a lista
  if (!roda) return <Navigate to="/rodas" replace />;

  const perms = rodaPerms(roda, me);
  const owner = isRodaOwner(roda, me);
  const text = channels.filter((c) => c.kind === "text");
  const voice = channels.filter((c) => c.kind === "voice");
  const members = Object.keys(roda.members).filter((id) => users[id] && !users[id].removed);

  async function leave() {
    if (!confirm(`Sair de ${roda!.name}? Para voltar, vai precisar de um convite.`)) return;
    try {
      await api.leaveRoda(roda!.id);
      void navigate("/rodas", { replace: true });
    } catch (err) {
      toast.fromError(err);
    }
  }

  return (
    <main className="page">
      <div className="page-inner page-inner-tight">
        <header
          className="roda-banner"
          data-image={roda.bannerUrl ? true : undefined}
          style={{ "--roda": rodaColor(roda.hue) } as React.CSSProperties}
        >
          {roda.bannerUrl && <img className="roda-banner-img" src={roda.bannerUrl} alt="" style={bannerImageStyle(roda)} />}
          <div className="roda-banner-top">
            <Link to="/rodas" className="btn btn-small btn-on-banner">
              ‹ Rodas
            </Link>
            <span className="roda-privacy">{roda.privacy === "aberta" ? "aberta" : "privada"}</span>
          </div>
          <h1 className="roda-title">{roda.name}</h1>
          {roda.description && <p className="roda-desc">{roda.description}</p>}
          <div className="roda-banner-foot">
            <span className="roda-faces">
              {members.slice(0, 5).map((id) => (
                <Avatar key={id} user={users[id]} size={32} plain />
              ))}
            </span>
            <span className="roda-count">
              {members.length} {members.length === 1 ? "membro" : "membros"}
            </span>
            <span className="roda-actions">
              {!owner && (
                <button type="button" className="btn btn-on-banner" onClick={() => void leave()}>
                  Sair
                </button>
              )}
              {canManageRoda(roda, me) && (
                <button type="button" className="btn btn-on-banner" onClick={() => useUi.getState().openRodaSettings(roda.id)}>
                  <Settings2 size={16} aria-hidden="true" /> Ajustes
                  {roda.requests.length > 0 && perms.has("convidar") && <span className="tab-badge">{roda.requests.length}</span>}
                </button>
              )}
              {perms.has("convidar") && (
                <button type="button" className="btn btn-ink" onClick={() => useUi.getState().setInviteRoda(roda.id)}>
                  Convidar
                </button>
              )}
            </span>
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
                {perms.has("salas") && <AddRoom rodaId={roda.id} kind="text" />}
              </div>
              {text.length > 0 ? (
                <ul className="room-list card">
                  {text.map((c) => (
                    <TextRoomRow key={c.id} channel={c} />
                  ))}
                </ul>
              ) : (
                <p className="empty-card">Nenhuma sala de texto.</p>
              )}
            </section>

            <section className="page-section" aria-labelledby="voice-rooms">
              <div className="section-head">
                <h2 id="voice-rooms" className="section-title">
                  Salas de voz
                </h2>
                <span className="mono-label">{voice.length}</span>
                {perms.has("salas") && <AddRoom rodaId={roda.id} kind="voice" />}
              </div>
              {voice.length > 0 ? (
                <div className="voice-cards">
                  {voice.map((c) => (
                    <VoiceRoomCard key={c.id} channel={c} canTalk={perms.has("voz")} />
                  ))}
                </div>
              ) : (
                <p className="empty-card">Nenhuma sala de voz.</p>
              )}
            </section>
          </div>
          <MemberList rodaId={roda.id} />
        </div>
      </div>
    </main>
  );
}

function AddRoom({ rodaId, kind }: { rodaId: string; kind: "text" | "voice" }) {
  return (
    <button type="button" className="btn btn-small btn-outline section-action" onClick={() => useUi.getState().setNewRoom({ rodaId, kind })}>
      {kind === "text" ? "+ Texto" : "+ Voz"}
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

function VoiceRoomCard({ channel, canTalk }: { channel: Channel; canTalk: boolean }) {
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
        className={here || !canTalk ? "btn" : "btn btn-primary"}
        onClick={() => {
          navigate(`/c/${channel.id}`);
          if (!here && canTalk) void joinVoice(channel.id);
        }}
      >
        {here ? "Abrir sala" : canTalk ? "Entrar" : "Ver sala"}
      </button>
    </div>
  );
}
