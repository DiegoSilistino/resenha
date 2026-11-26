import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  Eye,
  EyeOff,
  Maximize,
  Minimize,
  MicOff,
  HeadphoneOff,
  Pin,
  PinOff,
  SlidersHorizontal,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Track, type Participant, type VideoTrack } from "livekit-client";
import { placePopover } from "../chat/popover.ts";
import { Avatar } from "../components/Avatar.tsx";
import { useApp } from "../state/app.ts";
import { useSettings } from "../state/settings.ts";
import { setFocused, setWatching, toggleStreamMuted, useVoice } from "./controller.ts";
import { SignalIcon } from "./SignalIcon.tsx";
import { PLAY_MARK_MS } from "./soundboard.ts";

/** Fecha o painel ao clicar fora dele ou apertar Esc. */
function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", esc);
    };
  }, [ref, open, close]);
}

/**
 * Painel de volume solto na tela (position: fixed), colado no botão. Preso dentro do
 * quadradinho, ele era cortado pela borda e ficava pela metade nos quadros pequenos.
 */
function usePopPosition(box: RefObject<HTMLElement | null>, pop: RefObject<HTMLElement | null>, open: boolean) {
  const version = useVoice((s) => s.version); // a grade mudou: o botão pode ter saído do lugar
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = box.current?.querySelector("button");
      if (anchor && pop.current) setPos(placePopover(anchor, pop.current.offsetWidth, pop.current.offsetHeight));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, version, box, pop]);
  return pos ?? { visibility: "hidden" as const };
}

function VideoView({
  track,
  mirror,
  contain,
  onElement,
}: {
  track: VideoTrack;
  mirror?: boolean;
  contain?: boolean;
  /** Recebe o elemento <video> (para medir a qualidade recebida). */
  onElement?: (el: HTMLVideoElement | null) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    onElement?.(el);
    return () => {
      track.detach(el);
      onElement?.(null);
    };
  }, [track, onElement]);
  return (
    <video
      ref={ref}
      className="tile-video"
      data-mirror={mirror || undefined}
      data-contain={contain || undefined}
      autoPlay
      playsInline
      muted
    />
  );
}

export function ParticipantTile({ participant, channelId }: { participant: Participant; channelId: string }) {
  const userId = participant.identity;
  const user = useApp((s) => s.users[userId]);
  const member = useApp((s) => s.voice[channelId]?.find((m) => m.userId === userId));
  const speaking = useVoice((s) => !!s.speaking[userId]);
  const ping = useVoice((s) => s.pings[userId]);
  useVoice((s) => s.version); // redesenha quando a sala muda

  const cam = participant.getTrackPublication(Track.Source.Camera);
  const camTrack = cam && !cam.isMuted ? (cam.track as VideoTrack | undefined) : undefined;
  const mic = participant.getTrackPublication(Track.Source.Microphone);
  const micOff = !mic || mic.isMuted;
  const name = user?.displayName ?? participant.name ?? "…";

  return (
    <div
      className="tile"
      data-speaking={speaking || undefined}
      data-video={!!camTrack || undefined}
      style={user ? ({ "--tint": user.avatarColor } as React.CSSProperties) : undefined}
    >
      {camTrack ? (
        <VideoView track={camTrack} mirror={participant.isLocal} />
      ) : (
        <Avatar user={user} size={72} speaking={speaking} />
      )}
      <div className="tile-label">
        <span className="tile-name">
          {name}
          {participant.isLocal && " (você)"}
        </span>
        {member?.deafened ? (
          <HeadphoneOff size={14} aria-label="ensurdecido" />
        ) : micOff ? (
          <MicOff size={14} aria-label="microfone desligado" />
        ) : null}
        <SignalIcon quality={participant.connectionQuality} ping={ping} />
      </div>
      <SoundMark userId={userId} />
      {!participant.isLocal && <VolumeControl userId={userId} name={name} />}
    </div>
  );
}

/** Figurinha do som que a pessoa acabou de tocar na mesa de sons (some sozinha). */
function SoundMark({ userId }: { userId: string }) {
  const play = useVoice((s) => s.soundPlays[userId]);
  const sound = play?.sound;
  const [, expire] = useState(0);
  const left = play ? play.at + PLAY_MARK_MS - Date.now() : 0;
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => expire((n) => n + 1), left);
    return () => clearTimeout(t);
  }, [left, play?.at]);
  if (!sound || left <= 0) return null;
  return (
    <span key={play!.at} className="sound-mark" role="status" title={`Tocou "${sound.name}"`}>
      <span aria-hidden="true">{sound.emoji}</span>
      <span className="sr-only">tocou o som {sound.name}</span>
    </span>
  );
}

function VolumeControl({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLLabelElement>(null);
  useDismiss(box, open, () => setOpen(false));
  const popStyle = usePopPosition(box, pop, open);
  const volume = useSettings((s) => s.userVolumes[userId] ?? 1);
  return (
    <div className="tile-volume" ref={box} data-open={open || undefined}>
      <button
        type="button"
        className="icon-btn"
        aria-expanded={open}
        aria-label={`Volume da voz de ${name}`}
        title={`Volume da voz de ${name}`}
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal size={16} />
      </button>
      {open && (
        <label className="volume-pop" ref={pop} style={popStyle}>
          <span>
            Voz de {name}: {Math.round(volume * 100)}%
          </span>
          <input
            type="range"
            min={0}
            max={200}
            step={5}
            value={Math.round(volume * 100)}
            onChange={(e) => useSettings.getState().setUserVolume(userId, Number(e.target.value) / 100)}
          />
        </label>
      )}
    </div>
  );
}

interface VideoStats {
  width: number;
  height: number;
  fps: number;
  mbps: number;
}

/** Mede o que está chegando de fato: resolução e quadros exibidos, e a taxa de dados do LiveKit. */
function useVideoStats(el: HTMLVideoElement | null, track: VideoTrack | undefined): VideoStats | null {
  const [stats, setStats] = useState<VideoStats | null>(null);
  useEffect(() => {
    if (!el || !track) {
      setStats(null);
      return;
    }
    let lastFrames = el.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
    let lastAt = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const frames = el.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
      const fps = ((frames - lastFrames) * 1000) / Math.max(1, now - lastAt);
      lastFrames = frames;
      lastAt = now;
      setStats({
        width: el.videoWidth,
        height: el.videoHeight,
        fps: Math.max(0, Math.round(fps)),
        mbps: track.currentBitrate / 1_000_000,
      });
    }, 1_000);
    return () => clearInterval(id);
  }, [el, track]);
  return stats;
}

function formatStats(s: VideoStats): string {
  const parts = [`${s.height}p`, `${s.fps} fps`];
  if (s.mbps > 0) parts.push(`${s.mbps.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} Mbps`);
  return parts.join(" · ");
}

/**
 * Tela de alguém, como no Discord: antes de clicar em Assistir é só um quadradinho (nada de
 * vídeo chegando); assistindo, mostra o vídeo, e clicar nele fixa no quadro grande.
 * A sua própria tela aparece direto (não gasta internet).
 */
export function ScreenTile({ participant, focused = false }: { participant: Participant; focused?: boolean }) {
  const id = participant.identity;
  const user = useApp((s) => s.users[id]);
  const watched = useVoice((s) => participant.isLocal || !!s.watching[id]);
  const ref = useRef<HTMLDivElement>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  useVoice((s) => s.version);
  const pub = participant.getTrackPublication(Track.Source.ScreenShare);
  const track = pub?.track as VideoTrack | undefined;
  const stats = useVideoStats(videoEl, watched ? track : undefined);
  // O som da tela é uma faixa à parte: só existe se a pessoa marcou "compartilhar áudio".
  const hasAudio = !!participant.getTrackPublication(Track.Source.ScreenShareAudio);
  const fullscreen = useIsFullscreen(ref);
  if (!track) return null;
  const name = user?.displayName ?? participant.name ?? "Alguém";
  const title = participant.isLocal ? "Sua tela" : `Tela de ${name}`;
  const label = (
    <div className="tile-label">
      <span className="live-chip">ao vivo</span>
      <span className="tile-name">{title}</span>
    </div>
  );

  if (!watched) {
    return (
      <div className="screen-tile" data-idle>
        <button type="button" className="btn btn-primary btn-small" onClick={() => setWatching(id, true)}>
          <Eye size={16} aria-hidden="true" />
          Assistir
        </button>
        {label}
      </div>
    );
  }

  // Já em tela cheia, o mesmo botão sai dela (antes só o Esc saía).
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    const el = ref.current;
    const video = videoEl as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (el?.requestFullscreen) {
      void el
        .requestFullscreen()
        .then(() => {
          // celular em pé: vira de lado para a tela (deitada) ocupar a tela toda; sai sozinho ao fechar
          const wide = !video || video.videoWidth >= video.videoHeight;
          const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
          if (wide) return orientation.lock?.("landscape");
        })
        .catch(() => undefined);
    } else if (video?.webkitEnterFullscreen) {
      // iPhone: o Safari não põe um <div> em tela cheia, só o próprio <video> (player nativo),
      // e pausa o vídeo ao sair dele
      video.addEventListener("webkitendfullscreen", () => void video.play().catch(() => undefined), { once: true });
      video.webkitEnterFullscreen();
    }
  }
  const onVideo = (e: React.MouseEvent) => !(e.target as Element).closest(".screen-controls");

  return (
    <div
      className="screen-tile"
      ref={ref}
      data-focused={focused || undefined}
      title={focused || fullscreen ? undefined : "Clique para fixar no centro"}
      onClick={(e) => {
        if (!focused && !fullscreen && onVideo(e)) setFocused(id);
      }}
      onDoubleClick={(e) => {
        // no quadro grande, duplo clique no vídeo alterna a tela cheia (como no YouTube); nos botões, não
        if ((focused || fullscreen) && onVideo(e)) toggleFullscreen();
      }}
    >
      <VideoView track={track} contain onElement={setVideoEl} />
      {label}
      {stats && stats.height > 0 && (
        <span
          className="screen-stats"
          title={`${stats.width}×${stats.height}, ${participant.isLocal ? "enviando" : "recebendo"} agora`}
        >
          {formatStats(stats)}
        </span>
      )}
      <div className="screen-controls">
        {!participant.isLocal && hasAudio && <StreamVolume userId={id} name={name} />}
        {/* em tela cheia somem: trocar de lugar recriaria o quadro e sairia da tela cheia */}
        {!fullscreen && (
          <button
            type="button"
            className="icon-btn"
            aria-label={focused ? "Desafixar (voltar para a grade)" : "Fixar no centro"}
            title={focused ? "Desafixar (voltar para a grade)" : "Fixar no centro"}
            onClick={() => setFocused(focused ? null : id)}
          >
            {focused ? <PinOff size={18} /> : <Pin size={18} />}
          </button>
        )}
        {!fullscreen && !participant.isLocal && (
          <button
            type="button"
            className="icon-btn"
            aria-label="Parar de assistir"
            title="Parar de assistir"
            onClick={() => setWatching(id, false)}
          >
            <EyeOff size={18} />
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
          title={fullscreen ? "Sair da tela cheia (Esc)" : "Tela cheia (ou duplo clique no vídeo)"}
          onClick={toggleFullscreen}
        >
          {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
        </button>
      </div>
    </div>
  );
}

/** Este elemento está em tela cheia agora? (acompanha também o Esc e o F11 do navegador) */
function useIsFullscreen(ref: RefObject<HTMLElement | null>): boolean {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const update = () => setFull(!!ref.current && document.fullscreenElement === ref.current);
    update();
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, [ref]);
  return full;
}

/**
 * Volume do som da tela de uma pessoa (jogo, vídeo), separado da voz dela.
 * Fica no próprio vídeo, inclusive em tela cheia.
 */
function StreamVolume({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useDismiss(box, open, () => setOpen(false));
  const popStyle = usePopPosition(box, pop, open);
  const volume = useSettings((s) => s.streamVolumes[userId] ?? 1);
  const muted = useVoice((s) => !!s.streamMuted[userId]);
  const silent = muted || volume === 0;
  const Icon = silent ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const label = `Som da tela de ${name}`;

  return (
    <div className="stream-volume" ref={box} data-muted={silent || undefined} data-open={open || undefined}>
      <button
        type="button"
        className="icon-btn"
        aria-expanded={open}
        aria-label={`${label}${silent ? " (silenciado)" : ""}`}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon size={18} />
      </button>
      {open && (
        <div className="volume-pop stream-volume-pop" ref={pop} style={popStyle}>
          <label className="stream-volume-slider">
            <span>
              {label}: {muted ? "silenciado" : `${Math.round(volume * 100)}%`}
            </span>
            <input
              type="range"
              min={0}
              max={200}
              step={5}
              value={Math.round(volume * 100)}
              onChange={(e) => {
                useSettings.getState().setStreamVolume(userId, Number(e.target.value) / 100);
                if (muted) toggleStreamMuted(userId); // mexer no volume já reativa o som
              }}
            />
          </label>
          <div className="stream-volume-actions">
            <button type="button" className="btn btn-small" onClick={() => toggleStreamMuted(userId)}>
              {muted ? <Volume2 size={14} aria-hidden="true" /> : <VolumeX size={14} aria-hidden="true" />}
              {muted ? "Ativar som" : "Silenciar"}
            </button>
            {volume !== 1 && (
              <button
                type="button"
                className="btn btn-small btn-ghost"
                onClick={() => useSettings.getState().setStreamVolume(userId, 1)}
              >
                Voltar a 100%
              </button>
            )}
          </div>
          <small>Só muda o que você ouve. A voz de {name} continua no volume dela.</small>
        </div>
      )}
    </div>
  );
}
