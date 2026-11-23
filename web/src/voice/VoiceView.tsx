import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Captions as CaptionsIcon,
  Headphones,
  HeadphoneOff,
  MessageSquare,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Tv,
  Video,
  VideoOff,
} from "lucide-react";
import { Track } from "livekit-client";
import { useLocation } from "react-router";
import { APP_NAME, type Channel } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { ChatPanel } from "../chat/ChatPanel.tsx";
import { BackToRoda } from "../layout/BackToRoda.tsx";
import { useApp } from "../state/app.ts";
import { useSettings } from "../state/settings.ts";
import { SearchButton } from "../search/SearchButton.tsx";
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
import { fitGrid } from "./grid.ts";
import { SoundboardControl } from "./SoundboardPanel.tsx";
import { ParticipantTile, ScreenTile } from "./Tiles.tsx";

export function VoiceView({ channel }: { channel: Channel }) {
  const status = useVoice((s) => s.status);
  const voiceChannelId = useVoice((s) => s.channelId);
  const here = voiceChannelId === channel.id && status !== "idle";

  // Em tela larga o chat fica ao lado (e a escolha é lembrada); em tela estreita ele cobre a
  // chamada, então começa fechado e vale só nesta visita.
  const narrow = useMediaQuery("(max-width: 1100px)");
  const savedOpen = useSettings((s) => s.voiceChatOpen);
  const location = useLocation();
  const [narrowOpen, setNarrowOpen] = useState(() => !!(location.state as { openChat?: boolean } | null)?.openChat);
  const chatOpen = narrow ? narrowOpen : savedOpen;
  const toggleChat = () => (narrow ? setNarrowOpen(!chatOpen) : useSettings.getState().set({ voiceChatOpen: !chatOpen }));
  const unread = useApp((s) => (s.unread[channel.id] ?? 0) > 0);
  const inCall = useApp((s) => s.voice[channel.id]?.length ?? 0);

  useEffect(() => {
    useUi.getState().setPageTitle(channel.name);
  }, [channel.name]);

  // Pulo para uma mensagem deste chat (busca, citação): abre o painel do chat para ela aparecer.
  const jumpNonce = useUi((s) => (s.jump?.channelId === channel.id ? s.jump.nonce : 0));
  useEffect(() => {
    if (!jumpNonce) return;
    if (narrow) setNarrowOpen(true);
    else useSettings.getState().set({ voiceChatOpen: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpNonce]);

  return (
    <main className="main voice-view">
      <header className="main-header">
        <BackToRoda />
        <div className="main-titles">
          <span className="mono-label">sala de voz · {APP_NAME}</span>
          <h1 className="main-title">{channel.name}</h1>
        </div>
        <span className="mono-label voice-count">{inCall > 0 ? `${inCall} na call` : "ninguém na call"}</span>
        <div className="header-actions">
          <SearchButton />
          <button
            type="button"
            className="icon-btn header-action"
            data-badge={!chatOpen && unread ? true : undefined}
            aria-pressed={chatOpen}
            aria-label={chatOpen ? "Fechar o chat da chamada" : "Abrir o chat da chamada"}
            title={chatOpen ? "Fechar o chat" : "Abrir o chat"}
            onClick={toggleChat}
          >
            <MessageSquare size={20} />
          </button>
        </div>
      </header>
      <div className="voice-body" data-chat-open={chatOpen || undefined}>
        {here ? <Stage channel={channel} /> : <JoinCard channel={channel} />}
        {chatOpen && (
          <aside className="voice-chat" aria-label={`Chat de ${channel.name}`}>
            <ChatPanel channel={channel} />
          </aside>
        )}
      </div>
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
        {status === "connecting" ? "Conectando…" : "Entrar na call"}
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

  const watching = useVoice((s) => s.watching);
  const focusedId = useVoice((s) => s.focused);
  const participants = roomParticipants();
  const screens = participants.filter((p) => p.getTrackPublication(Track.Source.ScreenShare)?.track);
  // Fixada só vale enquanto a tela existe e você a assiste (parou de transmitir: volta para a grade).
  const focus = screens.find((p) => p.identity === focusedId && (p.isLocal || watching[p.identity]));
  const tiles = [
    ...screens
      .filter((p) => p !== focus)
      .map((p) => <ScreenTile key={`tela:${p.identity}`} participant={p} />),
    ...participants.map((p) => <ParticipantTile key={p.identity} participant={p} channelId={channel.id} />),
  ];

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
        {focus ? (
          <>
            <ScreenTile key={`tela:${focus.identity}`} participant={focus} focused />
            <div className="tiles-strip" style={{ "--tile-w": `${STRIP_TILE_W}px` } as React.CSSProperties}>
              {tiles}
            </div>
          </>
        ) : (
          <TileGrid count={tiles.length}>{tiles}</TileGrid>
        )}
      </div>

      {captionsView && <Captions />}

      <ControlBar channelId={channel.id} watch={visibility} />
    </div>
  );
}

const TILE_GAP = 12;
/** Abaixo disso, rolar é melhor que quadradinhos microscópicos. */
const MIN_TILE_W = 150;
/** Largura dos quadradinhos na faixa embaixo da tela fixada. */
const STRIP_TILE_W = 220;

/** Grade centralizada: com pouca gente os quadros são grandes; entrando mais, diminuem para caber todos. */
function TileGrid({ count, children }: { count: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure(); // antes de pintar: sem piscar quadradinhos pequenos ao entrar
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { cols, tileWidth } = fitGrid(count, box.width, box.height, TILE_GAP, 16 / 9);
  const w = Math.max(MIN_TILE_W, tileWidth);
  return (
    <div className="tiles" ref={ref}>
      {/* a largura máxima força o número de colunas calculado (5 pessoas: 3 + 2, não 4 + 1) */}
      <div
        className="tiles-fit"
        style={{ "--tile-w": `${w}px`, maxWidth: cols * w + (cols - 1) * TILE_GAP } as React.CSSProperties}
      >
        {children}
      </div>
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
      <SoundboardControl />
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
        <span className="control-text">Sair da call</span>
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

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
  );
}
