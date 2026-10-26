import { useEffect, useRef, useState, type RefObject } from "react";
import { Maximize, MicOff, HeadphoneOff, SlidersHorizontal, Volume1, Volume2, VolumeX } from "lucide-react";
import { Track, type Participant, type VideoTrack } from "livekit-client";
import { Avatar } from "../components/Avatar.tsx";
import { useApp } from "../state/app.ts";
import { useSettings } from "../state/settings.ts";
import { toggleStreamMuted, useVoice } from "./controller.ts";
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
  useVoice((s) => s.version); // redesenha quando a sala muda

  const cam = participant.getTrackPublication(Track.Source.Camera);
  const camTrack = cam && !cam.isMuted ? (cam.track as VideoTrack | undefined) : undefined;
  const mic = participant.getTrackPublication(Track.Source.Microphone);
  const micOff = !mic || mic.isMuted;
  const name = user?.displayName ?? participant.name ?? "…";

  return (
    <div className="tile" data-speaking={speaking || undefined} data-video={!!camTrack || undefined}>
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
        <SignalIcon quality={participant.connectionQuality} />
      </div>
      <SoundMark userId={userId} />
      {!participant.isLocal && <VolumeControl userId={userId} name={name} />}
    </div>
  );
}

/** Figurinha do som que a pessoa acabou de tocar na mesa de sons (some sozinha). */
function SoundMark({ userId }: { userId: string }) {
  const play = useVoice((s) => s.soundPlays[userId]);
  const sound = useApp((s) => (play ? s.sounds.find((x) => x.id === play.soundId) : undefined));
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
  useDismiss(box, open, () => setOpen(false));
  const volume = useSettings((s) => s.userVolumes[userId] ?? 1);
  return (
    <div className="tile-volume" ref={box}>
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
        <label className="volume-pop">
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

export function ScreenTile({ participant }: { participant: Participant }) {
  const user = useApp((s) => s.users[participant.identity]);
  const ref = useRef<HTMLDivElement>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  useVoice((s) => s.version);
  const pub = participant.getTrackPublication(Track.Source.ScreenShare);
  const track = pub?.track as VideoTrack | undefined;
  const stats = useVideoStats(videoEl, track);
  // O som da tela é uma faixa à parte: só existe se a pessoa marcou "compartilhar áudio".
  const hasAudio = !!participant.getTrackPublication(Track.Source.ScreenShareAudio);
  if (!track) return null;
  const name = user?.displayName ?? participant.name ?? "Alguém";

  return (
    <div className="screen-tile" ref={ref}>
      <VideoView track={track} contain onElement={setVideoEl} />
      <div className="tile-label">
        <span className="live-chip">ao vivo</span>
        <span className="tile-name">{participant.isLocal ? "Sua tela" : `Tela de ${name}`}</span>
      </div>
      {stats && stats.height > 0 && (
        <span
          className="screen-stats"
          title={`${stats.width}×${stats.height}, ${participant.isLocal ? "enviando" : "recebendo"} agora`}
        >
          {formatStats(stats)}
        </span>
      )}
      <div className="screen-controls">
        {!participant.isLocal && hasAudio && <StreamVolume userId={participant.identity} name={name} />}
        <button
          type="button"
          className="icon-btn"
          aria-label="Tela cheia"
          title="Tela cheia"
          onClick={() => void ref.current?.requestFullscreen?.()}
        >
          <Maximize size={18} />
        </button>
      </div>
    </div>
  );
}

/**
 * Volume do som da tela de uma pessoa (jogo, vídeo), separado da voz dela.
 * Fica no próprio vídeo, inclusive em tela cheia.
 */
function StreamVolume({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(box, open, () => setOpen(false));
  const volume = useSettings((s) => s.streamVolumes[userId] ?? 1);
  const muted = useVoice((s) => !!s.streamMuted[userId]);
  const silent = muted || volume === 0;
  const Icon = silent ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const label = `Som da tela de ${name}`;

  return (
    <div className="stream-volume" ref={box} data-muted={silent || undefined}>
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
        <div className="volume-pop stream-volume-pop">
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
