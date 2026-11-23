import { Link, NavLink, useNavigate } from "react-router";
import { MessageSquare, MicOff, HeadphoneOff, Plus, Settings2, Video } from "lucide-react";
import { APP_NAME, type Channel, type VoiceMember } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { initials } from "../lib/format.ts";
import { useApp } from "../state/app.ts";
import { useSettings } from "../state/settings.ts";
import { useUi } from "../state/ui.ts";
import { joinVoice, preloadVoice, useVoice } from "../voice/controller.ts";

/** Erro novo no painel do admin que ele ainda não viu. */
export function useAdminBadge() {
  const isAdmin = useApp((s) => !!s.me && s.me.role === "admin");
  const newErrors = useApp((s) => s.latestErrorId) > useSettings((s) => s.errorsSeenId);
  return { isAdmin, newErrors: isAdmin && newErrors };
}

/** Painel das salas da roda, ao lado da conversa ou da chamada (no celular, a página da roda faz esse papel). */
export function Sidebar() {
  const channels = useApp((s) => s.channels);
  const { isAdmin, newErrors } = useAdminBadge();
  const text = channels.filter((c) => c.kind === "text");
  const voice = channels.filter((c) => c.kind === "voice");

  return (
    <nav className="sidebar" aria-label="Salas">
      <header className="sidebar-header">
        <Link to="/roda" className="roda-link">
          <span className="roda-badge" aria-hidden="true">
            {initials(APP_NAME)}
          </span>
          <span className="roda-link-names">
            <span className="roda-link-name">{APP_NAME}</span>
            <span className="mono-label">ver a roda</span>
          </span>
        </Link>
        {isAdmin && (
          <button
            type="button"
            className="icon-btn admin-btn"
            data-badge={newErrors || undefined}
            onClick={() => useUi.getState().setAdminOpen(true)}
            aria-label={newErrors ? "Administrar grupo (tem erro novo no painel)" : "Administrar grupo"}
            title={newErrors ? "Administrar grupo: tem erro novo no painel" : "Administrar grupo"}
          >
            <Settings2 size={18} />
          </button>
        )}
      </header>

      <div className="channel-groups">
        <section>
          <GroupTitle title="texto" add={isAdmin ? "Nova sala de texto" : null} />
          <ul className="channel-list">
            {text.map((c) => (
              <TextChannelItem key={c.id} channel={c} />
            ))}
          </ul>
        </section>
        <section>
          <GroupTitle title="voz" add={isAdmin ? "Nova sala de voz" : null} />
          <ul className="channel-list">
            {voice.map((c) => (
              <VoiceChannelItem key={c.id} channel={c} />
            ))}
          </ul>
        </section>
      </div>
    </nav>
  );
}

function GroupTitle({ title, add }: { title: string; add: string | null }) {
  return (
    <div className="group-head">
      <h2 className="mono-label">{title}</h2>
      {add && (
        <button
          type="button"
          className="icon-btn icon-btn-round"
          onClick={() => useUi.getState().setAdminOpen(true, "channels")}
          aria-label={add}
          title={add}
        >
          <Plus size={16} />
        </button>
      )}
    </div>
  );
}

/** Três barrinhas de "som": acesas quando tem gente na sala. */
export function VoiceBars({ on }: { on: boolean }) {
  return (
    <span className="voice-bars" data-on={on || undefined} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function TextChannelItem({ channel }: { channel: Channel }) {
  const unread = useApp((s) => !!s.unread[channel.id]);
  const mentions = useApp((s) => s.mentions[channel.id] ?? 0);
  return (
    <li>
      <NavLink to={`/c/${channel.id}`} className="channel-link" data-unread={unread || undefined}>
        <span className="channel-hash" aria-hidden="true">
          #
        </span>
        <span className="channel-name">{channel.name}</span>
        {mentions > 0 ? (
          <span className="mention-badge" aria-label={`${mentions} ${mentions === 1 ? "menção" : "menções"} a você`}>
            {mentions > 99 ? "99+" : mentions}
          </span>
        ) : (
          unread && <span className="unread-dot" aria-label="mensagens novas" />
        )}
      </NavLink>
    </li>
  );
}

function VoiceChannelItem({ channel }: { channel: Channel }) {
  const members = useApp((s) => s.voice[channel.id]) ?? [];
  const navigate = useNavigate();
  const connectedHere = useVoice((s) => s.channelId === channel.id && s.status !== "idle");
  const unread = useApp((s) => !!s.unread[channel.id]);
  const mentions = useApp((s) => s.mentions[channel.id] ?? 0);

  return (
    <li className="voice-channel">
      <NavLink
        to={`/c/${channel.id}`}
        className="channel-link"
        data-connected={connectedHere || undefined}
        data-unread={unread || undefined}
        onPointerEnter={preloadVoice}
        onClick={(e) => {
          e.preventDefault();
          navigate(`/c/${channel.id}`);
          void joinVoice(channel.id);
        }}
      >
        <VoiceBars on={members.length > 0} />
        <span className="channel-name">{channel.name}</span>
        {mentions > 0 ? (
          <span className="mention-badge" aria-label={`${mentions} ${mentions === 1 ? "menção" : "menções"} a você no chat`}>
            {mentions > 99 ? "99+" : mentions}
          </span>
        ) : unread ? (
          <span className="unread-dot" aria-label="mensagens novas no chat" />
        ) : (
          members.length > 0 && <span className="channel-count">{members.length}</span>
        )}
      </NavLink>
      {/* Ler o chat do canal sem entrar na chamada */}
      <button
        type="button"
        className="icon-btn voice-chat-link"
        aria-label={`Abrir o chat de ${channel.name} sem entrar na chamada`}
        title="Abrir o chat sem entrar"
        onPointerEnter={preloadVoice}
        onClick={() => {
          useSettings.getState().set({ voiceChatOpen: true });
          navigate(`/c/${channel.id}`, { state: { openChat: true } });
        }}
      >
        <MessageSquare size={15} />
      </button>
      {members.length > 0 && (
        <ul className="voice-members" aria-label={`Pessoas em ${channel.name}`}>
          {members.map((m) => (
            <VoiceMemberItem key={m.userId} member={m} />
          ))}
        </ul>
      )}
    </li>
  );
}

function VoiceMemberItem({ member }: { member: VoiceMember }) {
  const user = useApp((s) => s.users[member.userId]);
  const speaking = useVoice((s) => !!s.speaking[member.userId]);
  return (
    <li className="voice-member">
      <Avatar user={user} size={22} speaking={speaking} />
      <span className="voice-member-name">{user?.displayName ?? "…"}</span>
      <span className="voice-member-flags">
        {member.streaming && <span className="live-chip" title="Compartilhando a tela">ao vivo</span>}
        {member.video && <Video size={14} aria-label="câmera ligada" />}
        {member.deafened ? (
          <HeadphoneOff size={14} aria-label="ensurdecido" />
        ) : member.muted ? (
          <MicOff size={14} aria-label="microfone desligado" />
        ) : null}
      </span>
    </li>
  );
}
