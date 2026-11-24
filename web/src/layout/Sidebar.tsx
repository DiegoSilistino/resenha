import { Link, NavLink, useNavigate } from "react-router";
import { MessageSquare, MicOff, HeadphoneOff, Plus, Settings2, ShieldAlert, Video } from "lucide-react";
import type { Channel, Me, Roda, VoiceMember } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { initials } from "../lib/format.ts";
import { isRodaOwner, rodaColor, rodaPerms, useApp } from "../state/app.ts";
import { useSettings } from "../state/settings.ts";
import { useUi } from "../state/ui.ts";
import { joinVoice, preloadVoice, useVoice } from "../voice/controller.ts";

/** Erro novo no painel do admin que ele ainda não viu. */
export function useAdminBadge() {
  const isAdmin = useApp((s) => !!s.me && s.me.role === "admin");
  const newErrors = useApp((s) => s.latestErrorId) > useSettings((s) => s.errorsSeenId);
  return { isAdmin, newErrors: isAdmin && newErrors };
}

/** Ícone da roda: quadradinho na cor dela com as iniciais. */
export function RodaBadge({ roda, size = 38 }: { roda: Pick<Roda, "name" | "hue">; size?: number }) {
  return (
    <span
      className="roda-badge"
      style={{ background: rodaColor(roda.hue), width: size, height: size, lineHeight: `${size}px`, fontSize: size * 0.32 }}
      aria-hidden="true"
    >
      {initials(roda.name)}
    </span>
  );
}

/** Quem pode abrir os Ajustes da roda: o dono e quem convida, expulsa ou mexe nas salas. */
export function canManageRoda(roda: Roda | undefined, me: Me | null | false): boolean {
  const perms = rodaPerms(roda, me);
  return isRodaOwner(roda, me) || perms.has("convidar") || perms.has("expulsar") || perms.has("salas");
}

/** Painel das salas da roda, ao lado da conversa ou da chamada (no celular, a página da roda faz esse papel). */
export function Sidebar({ rodaId }: { rodaId: string }) {
  const roda = useApp((s) => s.rodas[rodaId]);
  const me = useApp((s) => s.me);
  const channels = useApp((s) => s.channels).filter((c) => c.rodaId === rodaId);
  const { isAdmin, newErrors } = useAdminBadge();
  if (!roda) return null;
  const canRooms = rodaPerms(roda, me).has("salas");
  const text = channels.filter((c) => c.kind === "text");
  const voice = channels.filter((c) => c.kind === "voice");

  return (
    <nav className="sidebar" aria-label={`Salas de ${roda.name}`}>
      <header className="sidebar-header">
        <Link to={`/r/${roda.id}`} className="roda-link">
          <RodaBadge roda={roda} />
          <span className="roda-link-names">
            <span className="roda-link-name">{roda.name}</span>
            <span className="mono-label">ver a roda</span>
          </span>
        </Link>
        {canManageRoda(roda, me) && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => useUi.getState().openRodaSettings(roda.id)}
            aria-label={`Ajustes de ${roda.name}`}
            title="Ajustes da roda"
          >
            <Settings2 size={18} />
          </button>
        )}
        {isAdmin && newErrors && (
          <button
            type="button"
            className="icon-btn admin-btn"
            data-badge
            onClick={() => useUi.getState().setAdminOpen(true)}
            aria-label="Painel do servidor (tem erro novo)"
            title="Painel do servidor: tem erro novo"
          >
            <ShieldAlert size={18} />
          </button>
        )}
      </header>

      <div className="channel-groups">
        <section>
          <GroupTitle title="texto" add={canRooms ? { rodaId: roda.id, kind: "text" } : null} />
          <ul className="channel-list">
            {text.map((c) => (
              <TextChannelItem key={c.id} channel={c} />
            ))}
          </ul>
        </section>
        <section>
          <GroupTitle title="voz" add={canRooms ? { rodaId: roda.id, kind: "voice" } : null} />
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

function GroupTitle({ title, add }: { title: string; add: { rodaId: string; kind: "text" | "voice" } | null }) {
  const label = add?.kind === "voice" ? "Nova sala de voz" : "Nova sala de texto";
  return (
    <div className="group-head">
      <h2 className="mono-label">{title}</h2>
      {add && (
        <button
          type="button"
          className="icon-btn icon-btn-round"
          onClick={() => useUi.getState().setNewRoom(add)}
          aria-label={label}
          title={label}
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
