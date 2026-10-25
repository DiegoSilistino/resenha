import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { ExternalLink, Pause, Play, SkipForward, Square, Volume2, X } from "lucide-react";
import { watchPositionAt, youTubeWatchUrl, type WatchClientAction, type WatchState } from "@resenha/shared";
import { clock, realtime } from "../lib/realtime.ts";
import { formatDuration } from "../lib/format.ts";
import { useApp } from "../state/app.ts";
import { useSettings } from "../state/settings.ts";
import { toast } from "../state/toasts.ts";
import { useVoice } from "../voice/controller.ts";
import { useWatchSlot } from "./slot.ts";
import { useWatchUi, useWatchVisibility } from "./visibility.ts";
import { loadYouTubeApi, YT_STATE, type YTPlayer } from "./youtube.ts";

/** Diferença tolerada entre o seu player e o relógio do servidor antes de corrigir. */
const DRIFT_PLAYING_S = 1.5;
const DRIFT_PAUSED_S = 1;

export function WatchDock() {
  const channelId = useVoice((s) => (s.status !== "idle" ? s.channelId : null));
  const state = useApp((s) => (channelId ? s.watch[channelId] : undefined));
  const { playerVisible, sessionId } = useWatchVisibility(channelId, state);
  // Escondido = o player é desmontado: sem som e sem gastar internet.
  if (!channelId || !state?.current || !playerVisible || !sessionId) return null;
  return <Dock state={state} sessionId={sessionId} />;
}

function Dock({ state, sessionId }: { state: WatchState; sessionId: string }) {
  const slot = useWatchSlot((s) => s.slot);
  const style = useSlotStyle(slot);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const loadedItemRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [duration, setDuration] = useState(0);
  const [, setTick] = useState(0);

  const volume = useSettings((s) => s.watchVolume);
  const deafened = useVoice((s) => s.deafened);

  const send = useCallback((action: WatchClientAction) => {
    realtime.send({ type: "watch", channelId: stateRef.current.channelId, action });
  }, []);
  /** Posição sendo arrastada na barra (só vai ao servidor quando solta). */
  const [scrub, setScrub] = useState<number | null>(null);
  const commitScrub = () => {
    if (scrub === null) return;
    send({ kind: "seek", seconds: scrub });
    setScrub(null);
  };

  /** Alinha o player com o estado do servidor. Roda a cada mudança e a cada segundo. */
  const sync = useCallback(() => {
    const p = playerRef.current;
    const s = stateRef.current;
    if (!p || !s.current) return;
    const expected = watchPositionAt(s, clock.serverNow());

    if (loadedItemRef.current !== s.current.id) {
      loadedItemRef.current = s.current.id;
      setDuration(0);
      const opts = { videoId: s.current.videoId, startSeconds: expected };
      if (s.playing) p.loadVideoById(opts);
      else p.cueVideoById(opts);
      return;
    }

    const ps = p.getPlayerState();
    const now = p.getCurrentTime();
    const d = p.getDuration();
    if (d > 0) setDuration(d);
    const canSeek = ps === YT_STATE.PLAYING || ps === YT_STATE.PAUSED || ps === YT_STATE.CUED;

    if (s.playing) {
      if (ps === YT_STATE.ENDED) return; // aguardando o servidor avançar a fila
      if (ps !== YT_STATE.PLAYING && ps !== YT_STATE.BUFFERING) p.playVideo();
      if (canSeek && Math.abs(now - expected) > DRIFT_PLAYING_S) p.seekTo(expected, true);
    } else {
      if (ps === YT_STATE.PLAYING || ps === YT_STATE.BUFFERING) p.pauseVideo();
      if (canSeek && Math.abs(now - expected) > DRIFT_PAUSED_S) p.seekTo(expected, true);
    }
  }, []);

  // Cria o player uma vez.
  useEffect(() => {
    let destroyed = false;
    const mount = document.createElement("div");
    hostRef.current?.appendChild(mount);
    loadYouTubeApi()
      .then((YT) => {
        if (destroyed) return;
        playerRef.current = new YT.Player(mount, {
          host: "https://www.youtube-nocookie.com",
          width: "100%",
          height: "100%",
          playerVars: {
            controls: 0, // os controles são nossos: toda ação passa pelo servidor
            disablekb: 1,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            fs: 0,
            origin: location.origin,
          },
          events: {
            onReady: () => setReady(true),
            onAutoplayBlocked: () => setBlocked(true),
            onStateChange: (e) => {
              if (e.data === YT_STATE.PLAYING) setBlocked(false);
              const cur = stateRef.current.current;
              if (e.data === YT_STATE.ENDED && cur && loadedItemRef.current === cur.id) {
                send({ kind: "ended", itemId: cur.id });
              }
            },
            onError: () => {
              const cur = stateRef.current.current;
              if (!cur) return;
              toast.error(`Não foi possível tocar "${cur.title}". Pulando.`);
              send({ kind: "ended", itemId: cur.id });
            },
          },
        });
      })
      .catch((err: Error) => toast.error(err.message));
    const host = hostRef.current;
    return () => {
      destroyed = true;
      playerRef.current?.destroy();
      playerRef.current = null;
      loadedItemRef.current = null;
      host?.replaceChildren(); // não deixa div órfã empurrando o próximo player
      setReady(false);
    };
  }, [send]);

  useEffect(() => {
    if (ready) sync();
  }, [ready, state, sync]);

  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      sync();
      setTick((t) => t + 1); // atualiza a barra de progresso
    }, 1_000);
    return () => clearInterval(id);
  }, [ready, sync]);

  useEffect(() => {
    if (ready) playerRef.current?.setVolume(deafened ? 0 : volume);
  }, [ready, volume, deafened]);

  // Se o navegador não deixar tocar sozinho, mostra um botão para tocar junto.
  useEffect(() => {
    if (!ready || !state.playing) return;
    const id = setTimeout(() => {
      const ps = playerRef.current?.getPlayerState();
      if (ps === YT_STATE.UNSTARTED || ps === YT_STATE.CUED) setBlocked(true);
    }, 4_000);
    return () => clearTimeout(id);
  }, [ready, state.playing, state.current?.id]);

  const current = state.current!;
  const position = Math.min(watchPositionAt(state, clock.serverNow()), duration || Infinity);
  const mini = !style;

  return (
    <section className="watch-dock" data-mini={mini || undefined} style={style} aria-label="Assistir juntos">
      <div className="watch-video">
        <div ref={hostRef} className="watch-iframe-host" />
        {blocked && (
          <button
            type="button"
            className="watch-unblock"
            onClick={() => {
              playerRef.current?.playVideo();
              setBlocked(false);
              sync();
            }}
          >
            <Play size={20} /> Tocar junto com a turma
          </button>
        )}
      </div>

      <div className="watch-controls">
        <button
          type="button"
          className="icon-btn"
          onClick={() => send({ kind: state.playing ? "pause" : "resume" })}
          aria-label={state.playing ? "Pausar para todos" : "Continuar para todos"}
        >
          {state.playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button type="button" className="icon-btn" onClick={() => send({ kind: "skip" })} aria-label="Pular vídeo">
          <SkipForward size={18} />
        </button>

        <div className="watch-meta">
          {mini ? (
            <Link to={`/c/${state.channelId}`} className="watch-title" title={current.title}>
              {current.title}
            </Link>
          ) : (
            <span className="watch-title" title={current.title}>
              {current.title}
            </span>
          )}
          <input
            type="range"
            className="watch-progress"
            min={0}
            max={Math.max(1, Math.floor(duration))}
            step={1}
            value={Math.floor(scrub ?? position)}
            disabled={!duration}
            aria-label="Posição do vídeo"
            aria-valuetext={formatDuration(scrub ?? position)}
            onChange={(e) => setScrub(Number(e.target.value))}
            onPointerUp={commitScrub}
            onKeyUp={commitScrub}
            onBlur={commitScrub}
          />
        </div>
        <span className="watch-time">
          {formatDuration(scrub ?? position)}
          {duration ? ` / ${formatDuration(duration)}` : ""}
        </span>

        {!mini && (
          <label className="watch-volume" title="Volume (só para você)">
            <Volume2 size={16} aria-hidden="true" />
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              aria-label="Volume do vídeo, só para você"
              onChange={(e) => useSettings.getState().set({ watchVolume: Number(e.target.value) })}
            />
          </label>
        )}
        {!mini && (
          <a
            className="icon-btn"
            href={youTubeWatchUrl(current.videoId)}
            target="_blank"
            rel="noreferrer"
            aria-label="Abrir no YouTube"
            title="Abrir no YouTube"
          >
            <ExternalLink size={16} />
          </a>
        )}
        <button
          type="button"
          className="icon-btn"
          data-danger
          aria-label="Encerrar para todos"
          title="Encerrar para todos"
          onClick={() => {
            const queued = state.queue.length;
            if (queued > 0 && !confirm(`Encerrar para todos e limpar a fila (${queued} na fila)?`)) return;
            send({ kind: "clear" });
            useWatchUi.getState().setPanelOpen(state.channelId, false); // fecha tudo para quem encerrou
          }}
        >
          <Square size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Esconder só para você"
          title="Esconder só para você (continua para os outros)"
          onClick={() => useWatchUi.getState().hide(state.channelId, sessionId)}
        >
          <X size={18} />
        </button>
      </div>
    </section>
  );
}

/**
 * Posiciona o dock exatamente sobre a vaga registrada (ou deixa o CSS do mini player agir).
 * Lê a posição a cada quadro e só re-renderiza quando ela muda: assim acompanha
 * redimensionamento, rolagem e avisos que empurram a vaga, sem depender de eventos.
 */
function useSlotStyle(slot: HTMLElement | null): CSSProperties | undefined {
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    if (!slot) {
      setRect(null);
      return;
    }
    let frame = 0;
    let last = "";
    const tick = () => {
      const r = slot.getBoundingClientRect();
      const key = `${r.top}|${r.left}|${r.width}|${r.height}`;
      if (key !== last) {
        last = key;
        // vaga escondida (ex.: o chat cobre a chamada em tela estreita): vira mini player
        setRect(r.width > 0 && r.height > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [slot]);

  if (!slot || !rect) return undefined;
  return { position: "fixed", ...rect };
}
