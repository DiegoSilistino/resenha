import { useEffect, useRef } from "react";
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
import { useWatchUi, useWatchVisibility, type WatchVisibility } from "../watch/visibility.ts";
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
    useUi.getState().setPageTitle(channel.name);
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
  const visibility = useWatchVisibility(channel.id, watch);

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
      {visibility.areaVisible && (
        <div className="watch-area" data-playing={visibility.playerVisible || undefined}>
          {visibility.playerVisible && <WatchSlot />}
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

      <ControlBar channelId={channel.id} watch={visibility} />
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

/**
 * Botão da TV:
 * - nada tocando: abre/fecha o painel para colocar um vídeo;
 * - tocando e visível: esconde SÓ para você (os outros continuam assistindo);
 * - tocando e escondido: mostra de novo (o pontinho avisa que tem algo rolando).
 */
function toggleWatch(channelId: string, watch: WatchVisibility) {
  const ui = useWatchUi.getState();
  if (watch.active && watch.sessionId) {
    if (watch.playerVisible) ui.hide(channelId, watch.sessionId);
    else ui.show(channelId);
    return;
  }
  ui.setPanelOpen(channelId, !watch.areaVisible);
}

function watchButtonLabel(watch: WatchVisibility): string {
  if (watch.active) {
    return watch.playerVisible
      ? "Esconder o Assistir juntos (só para você)"
      : "Voltar ao Assistir juntos (tem vídeo tocando)";
  }
  return watch.areaVisible ? "Fechar Assistir juntos" : "Assistir juntos";
}

function ControlBar({ channelId, watch }: { channelId: string; watch: WatchVisibility }) {
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
        label={watchButtonLabel(watch)}
        active={watch.areaVisible}
        badge={watch.active && !watch.playerVisible}
        onClick={() => toggleWatch(channelId, watch)}
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
  badge,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  solid?: boolean;
  /** Pontinho âmbar: algo acontecendo que você não está vendo. */
  badge?: boolean;
  disabled?: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="control-btn"
      data-active={active || undefined}
      data-badge={badge || undefined}
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
