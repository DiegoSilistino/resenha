import { useEffect, useRef, useState } from "react";
import {
  Captions as CaptionsIcon,
  Headphones,
  HeadphoneOff,
  Menu,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Tv,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react";
import { Track } from "livekit-client";
import type { Channel } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { useApp } from "../state/app.ts";
import { useSettings } from "../state/settings.ts";
import { useUi } from "../state/ui.ts";
import { WatchPanel } from "../watch/WatchPanel.tsx";
import { useWatchSlot } from "../watch/slot.ts";
import { Captions } from "./Captions.tsx";
import {
  joinVoice,
  leaveVoice,
  roomParticipants,
  toggleCamera,
  toggleDeafen,
  toggleMute,
  toggleScreenShare,
  unlockAudio,
  useVoice,
} from "./controller.ts";
import { ParticipantTile, ScreenTile } from "./Tiles.tsx";

export function VoiceView({ channel }: { channel: Channel }) {
  const status = useVoice((s) => s.status);
  const voiceChannelId = useVoice((s) => s.channelId);
  const here = voiceChannelId === channel.id && status !== "idle";

  useEffect(() => {
    document.title = channel.name;
  }, [channel.name]);

  return (
    <main className="main voice-view">
      <header className="main-header">
        <button
          type="button"
          className="icon-btn nav-toggle"
          onClick={() => useUi.getState().setNavOpen(true)}
          aria-label="Abrir lista de canais"
        >
          <Menu size={20} />
        </button>
        <Volume2 size={20} aria-hidden="true" className="header-icon" />
        <h1 className="main-title">{channel.name}</h1>
      </header>
      {here ? <Stage channel={channel} /> : <JoinCard channel={channel} />}
    </main>
  );
}

function JoinCard({ channel }: { channel: Channel }) {
  const members = useApp((s) => s.voice[channel.id]) ?? [];
  const users = useApp((s) => s.users);
  const status = useVoice((s) => s.status);
  const currentVoiceId = useVoice((s) => (s.status !== "idle" ? s.channelId : null));
  const otherChannel = useApp((s) =>
    currentVoiceId && currentVoiceId !== channel.id ? s.channels.find((c) => c.id === currentVoiceId) : undefined,
  );

  return (
    <div className="join-card">
      {members.length > 0 ? (
        <>
          <div className="join-avatars">
            {members.map((m) => (
              <Avatar key={m.userId} user={users[m.userId]} size={56} />
            ))}
          </div>
          <p>
            {members.length === 1
              ? `${users[members[0]!.userId]?.displayName ?? "Alguém"} está aqui.`
              : `${members.length} pessoas estão aqui.`}
          </p>
        </>
      ) : (
        <p>Ninguém por aqui ainda. Entre e chame a turma.</p>
      )}
      {otherChannel && <p className="join-note">Você está em {otherChannel.name}. Entrar aqui troca de canal.</p>}
      <button
        type="button"
        className="btn btn-primary btn-lg"
        disabled={status === "connecting"}
        onClick={() => void joinVoice(channel.id)}
      >
        {status === "connecting" ? "Conectando…" : "Entrar no canal"}
      </button>
    </div>
  );
}

function Stage({ channel }: { channel: Channel }) {
  useVoice((s) => s.version);
  const status = useVoice((s) => s.status);
  const audioBlocked = useVoice((s) => s.audioBlocked);
  const captionsView = useSettings((s) => s.captionsView);
  const watch = useApp((s) => s.watch[channel.id]);
  const [panelOpen, setPanelOpen] = useState(() => !!watch?.current);
  const playing = !!watch?.current;
  const showWatch = panelOpen || playing;

  const participants = roomParticipants();
  const screens = participants.filter((p) => p.getTrackPublication(Track.Source.ScreenShare)?.track);

  return (
    <div className="stage">
      {status === "reconnecting" && <div className="stage-banner">Conexão instável, reconectando a voz…</div>}
      {audioBlocked && (
        <button type="button" className="stage-banner stage-banner-action" onClick={() => void unlockAudio()}>
          O navegador bloqueou o som. Clique aqui para ouvir a turma.
        </button>
      )}

      {/* Fora da área que rola: o player (posicionado sobre a vaga) nunca sobe por cima do cabeçalho. */}
      {showWatch && (
        <div className="watch-area" data-playing={playing || undefined}>
          {playing && <WatchSlot />}
          <WatchPanel channelId={channel.id} state={watch} />
        </div>
      )}

      <div className="stage-scroll">
        {screens.length > 0 && (
          <div className="screens">
            {screens.map((p) => (
              <ScreenTile key={p.identity} participant={p} />
            ))}
          </div>
        )}

        <div className="tiles" data-count={Math.min(participants.length, 9)}>
          {participants.map((p) => (
            <ParticipantTile key={p.identity} participant={p} channelId={channel.id} />
          ))}
        </div>
      </div>

      {captionsView && <Captions />}

      <ControlBar watchOpen={showWatch} onToggleWatch={() => setPanelOpen((o) => !o || playing)} playing={playing} />
    </div>
  );
}

/** Vaga onde o player do YouTube (montado no app) se posiciona. */
function WatchSlot() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    useWatchSlot.getState().setSlot(ref.current);
    return () => {
      if (useWatchSlot.getState().slot === ref.current) useWatchSlot.getState().setSlot(null);
    };
  }, []);
  return <div ref={ref} className="watch-slot" />;
}

function ControlBar({
  watchOpen,
  onToggleWatch,
  playing,
}: {
  watchOpen: boolean;
  onToggleWatch(): void;
  playing: boolean;
}) {
  const muted = useVoice((s) => s.muted);
  const deafened = useVoice((s) => s.deafened);
  const sharing = useVoice((s) => s.screenSharing);
  const camera = useVoice((s) => s.cameraOn);
  const connected = useVoice((s) => s.status === "connected");
  const captionsView = useSettings((s) => s.captionsView);
  const micOff = muted || deafened;

  return (
    <div className="control-bar" role="toolbar" aria-label="Controles da chamada">
      <ControlButton
        label={micOff ? "Ligar microfone" : "Desligar microfone"}
        active={!micOff}
        danger={micOff}
        onClick={toggleMute}
      >
        {micOff ? <MicOff /> : <Mic />}
      </ControlButton>
      <ControlButton label={deafened ? "Voltar a ouvir" : "Ensurdecer"} danger={deafened} onClick={toggleDeafen}>
        {deafened ? <HeadphoneOff /> : <Headphones />}
      </ControlButton>
      <ControlButton
        label={sharing ? "Parar de compartilhar a tela" : "Compartilhar a tela"}
        active={sharing}
        disabled={!connected}
        onClick={() => void toggleScreenShare()}
      >
        {sharing ? <MonitorOff /> : <Monitor />}
      </ControlButton>
      <ControlButton
        label={camera ? "Desligar câmera" : "Ligar câmera"}
        active={camera}
        disabled={!connected}
        onClick={() => void toggleCamera()}
      >
        {camera ? <Video /> : <VideoOff />}
      </ControlButton>
      <ControlButton
        label={captionsView ? "Esconder legendas" : "Mostrar legendas"}
        active={captionsView}
        onClick={() => useSettings.getState().set({ captionsView: !captionsView })}
      >
        <CaptionsIcon />
      </ControlButton>
      <ControlButton
        label={playing ? "Assistir juntos (tocando)" : watchOpen ? "Fechar Assistir juntos" : "Assistir juntos"}
        active={watchOpen}
        onClick={onToggleWatch}
      >
        <Tv />
      </ControlButton>
      <ControlButton label="Sair da chamada" danger solid onClick={() => void leaveVoice()}>
        <PhoneOff />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  label,
  active,
  danger,
  solid,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  solid?: boolean;
  disabled?: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="control-btn"
      data-active={active || undefined}
      data-danger={danger || undefined}
      data-solid={solid || undefined}
      aria-pressed={active}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
