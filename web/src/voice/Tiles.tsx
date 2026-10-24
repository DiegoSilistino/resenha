import { useEffect, useRef, useState } from "react";
import { Maximize, MicOff, HeadphoneOff, SlidersHorizontal } from "lucide-react";
import { Track, type Participant, type VideoTrack } from "livekit-client";
import { Avatar } from "../components/Avatar.tsx";
import { useApp } from "../state/app.ts";
import { useSettings } from "../state/settings.ts";
import { useVoice } from "./controller.ts";

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
      </div>
      {!participant.isLocal && <VolumeControl userId={userId} name={name} />}
    </div>
  );
}

function VolumeControl({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const volume = useSettings((s) => s.userVolumes[userId] ?? 1);
  return (
    <div className="tile-volume">
      <button
        type="button"
        className="icon-btn"
        aria-expanded={open}
        aria-label={`Volume de ${name}`}
        title={`Volume de ${name}`}
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal size={16} />
      </button>
      {open && (
        <label className="volume-pop">
          <span>
            Volume de {name}: {Math.round(volume * 100)}%
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
      <button
        type="button"
        className="icon-btn screen-full"
        aria-label="Tela cheia"
        title="Tela cheia"
        onClick={() => void ref.current?.requestFullscreen?.()}
      >
        <Maximize size={18} />
      </button>
    </div>
  );
}
