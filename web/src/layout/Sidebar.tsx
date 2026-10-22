import { NavLink, useNavigate } from "react-router";
import { Hash, MicOff, HeadphoneOff, Settings2, Video, Volume2 } from "lucide-react";
import { APP_NAME, type Channel, type VoiceMember } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { useApp } from "../state/app.ts";
import { useUi } from "../state/ui.ts";
import { joinVoice, useVoice } from "../voice/controller.ts";
import { UserPanel } from "./UserPanel.tsx";
import { VoiceBar } from "./VoiceBar.tsx";

export function Sidebar() {
  const channels = useApp((s) => s.channels);
  const isAdmin = useApp((s) => s.me && s.me.role === "admin");
  const text = channels.filter((c) => c.kind === "text");
  const voice = channels.filter((c) => c.kind === "voice");

  return (
    <nav className="sidebar" aria-label="Canais">
      <header className="sidebar-header">
        <span className="wordmark">{APP_NAME}</span>
        {isAdmin && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => useUi.getState().setAdminOpen(true)}
            aria-label="Administrar grupo"
            title="Administrar grupo"
          >
            <Settings2 size={18} />
          </button>
        )}
      </header>

      <div className="channel-groups">
        <section>
          <h2 className="group-title">Texto</h2>
          <ul className="channel-list">
            {text.map((c) => (
              <TextChannelItem key={c.id} channel={c} />
            ))}
          </ul>
        </section>
        <section>
          <h2 className="group-title">Voz</h2>
          <ul className="channel-list">
            {voice.map((c) => (
              <VoiceChannelItem key={c.id} channel={c} />
            ))}
          </ul>
        </section>
      </div>

      <VoiceBar />
      <UserPanel />
    </nav>
  );
}

function TextChannelItem({ channel }: { channel: Channel }) {
  const unread = useApp((s) => !!s.unread[channel.id]);
  return (
    <li>
      <NavLink to={`/c/${channel.id}`} className="channel-link" data-unread={unread || undefined}>
        <Hash size={18} aria-hidden="true" />
        <span className="channel-name">{channel.name}</span>
        {unread && <span className="unread-dot" aria-label="mensagens novas" />}
      </NavLink>
    </li>
  );
}

function VoiceChannelItem({ channel }: { channel: Channel }) {
  const members = useApp((s) => s.voice[channel.id]) ?? [];
  const navigate = useNavigate();
  const connectedHere = useVoice((s) => s.channelId === channel.id && s.status !== "idle");

  return (
    <li>
      <NavLink
        to={`/c/${channel.id}`}
        className="channel-link"
        data-connected={connectedHere || undefined}
        onClick={(e) => {
          e.preventDefault();
          navigate(`/c/${channel.id}`);
          void joinVoice(channel.id);
        }}
      >
        <Volume2 size={18} aria-hidden="true" />
        <span className="channel-name">{channel.name}</span>
      </NavLink>
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
