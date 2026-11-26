import { useRef, useState, type MouseEvent } from "react";
import { Download, ExternalLink, FileAudio, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import type { Attachment } from "@resenha/shared";
import { Modal } from "../components/Modal.tsx";
import { formatBytes, formatDuration } from "../lib/format.ts";
import { useSettings } from "../state/settings.ts";
import { toast } from "../state/toasts.ts";

/** Foto do chat: clicar abre ampliada aqui mesmo (como no Discord); Ctrl+clique ou o botão do meio ainda abrem outra aba. */
export function ImageAttachment({ a }: { a: Attachment }) {
  const [open, setOpen] = useState(false);
  const onClick = (e: MouseEvent) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    setOpen(true);
  };
  return (
    <>
      <a href={a.url} target="_blank" rel="noreferrer" className="attachment-image" onClick={onClick}>
        <img src={a.url} alt={a.filename} loading="lazy" />
      </a>
      {open && (
        <Modal title={a.filename} onClose={() => setOpen(false)} bare>
          <figure className="lightbox">
            <div className="lightbox-frame">
              <img src={a.url} alt={a.filename} />
              <button type="button" className="lightbox-close" onClick={() => setOpen(false)} aria-label="Fechar" title="Fechar (Esc)">
                <X size={20} />
              </button>
            </div>
            <figcaption>
              <a href={a.url} target="_blank" rel="noreferrer">
                <ExternalLink size={14} aria-hidden="true" /> Abrir no navegador
              </a>
            </figcaption>
          </figure>
        </Modal>
      )}
    </>
  );
}

// o volume escolhido vale para os próximos áudios desta sessão
let lastVolume = 1;

/** Áudio no chat (como no Discord): tocar/pausar, posição e volume, sem sair da conversa. */
export function AudioAttachment({ a }: { a: Attachment }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(lastVolume);
  const [muted, setMuted] = useState(false);

  // curva perceptual, como nos sons do app: 50% no controle soa como metade
  const apply = (v: number, mute: boolean) => {
    const el = ref.current;
    if (!el) return;
    el.volume = v ** 2;
    el.muted = mute;
  };

  function toggle() {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => toast.error("Não deu para tocar esse áudio."));
    else el.pause();
  }

  return (
    <div className="audio-attachment">
      <div className="audio-head">
        <FileAudio size={22} aria-hidden="true" />
        <span className="attachment-file-name">{a.filename}</span>
        <span className="attachment-file-size">{formatBytes(a.size)}</span>
        <a href={a.url} download={a.filename} className="icon-btn" aria-label={`Baixar ${a.filename}`} title="Baixar">
          <Download size={16} />
        </a>
      </div>
      <div className="audio-controls">
        <button type="button" className="icon-btn audio-play" onClick={toggle} aria-label={playing ? "Pausar" : "Tocar"}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <span className="audio-time">
          {formatDuration(time)} / {duration ? formatDuration(duration) : "--:--"}
        </span>
        <input
          type="range"
          className="audio-seek"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(time, duration || 0)}
          disabled={!duration}
          aria-label="Posição do áudio"
          aria-valuetext={formatDuration(time)}
          onChange={(e) => {
            const t = Number(e.target.value);
            if (ref.current) ref.current.currentTime = t;
            setTime(t);
          }}
        />
        <button
          type="button"
          className="icon-btn"
          onClick={() => {
            setMuted(!muted);
            apply(volume, !muted);
          }}
          aria-label={muted ? "Ligar o som" : "Silenciar"}
          title={muted ? "Ligar o som" : "Silenciar"}
        >
          {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <input
          type="range"
          className="audio-volume"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          aria-label="Volume"
          aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
          onChange={(e) => {
            const v = Number(e.target.value);
            lastVolume = v;
            setVolume(v);
            setMuted(false);
            apply(v, false);
          }}
        />
      </div>
      <audio
        ref={ref}
        src={a.url}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          setDuration(Number.isFinite(el.duration) ? el.duration : 0);
          apply(volume, muted);
          // toca na saída de som escolhida nas configurações (fone, caixa…), como as chamadas
          const sink = useSettings.getState().speakerDeviceId;
          if (sink && "setSinkId" in el) void el.setSinkId(sink).catch(() => undefined);
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}
