import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, AudioLines, Pause, Play, Plus, Trash2, Upload } from "lucide-react";
import { LIMITS, type SoundboardSound } from "@resenha/shared";
import { EmojiPicker } from "../chat/EmojiPicker.tsx";
import { api } from "../lib/api.ts";
import { useApp } from "../state/app.ts";
import { rememberEmoji, useSettings } from "../state/settings.ts";
import { toast } from "../state/toasts.ts";
import { buildClip, CLIP_SAMPLE_RATE, decodeSource, firstSoundAt, monoOverview, waveformPeaks } from "./soundClip.ts";
import { playBuffer, requestSound, soundboardAudio } from "./soundboard.ts";
import { useVoice } from "./state.ts";

const WIDTH = 380;
const HEIGHT = 460;
const GAP = 10;

/** Abre para cima, centrado no botão (a barra da chamada fica no pé da tela). */
function place(anchor: HTMLElement): CSSProperties {
  const r = anchor.getBoundingClientRect();
  const width = Math.min(WIDTH, window.innerWidth - 16);
  const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8);
  return { left, width, bottom: window.innerHeight - r.top + GAP, maxHeight: Math.min(HEIGHT, r.top - GAP - 8) };
}

/** Botão da mesa de sons na barra da chamada, com o painel que abre em cima dele. */
export function SoundboardControl() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const connected = useVoice((s) => s.status === "connected");
  const close = useCallback(() => setAnchor(null), []);
  const label = "Mesa de sons";
  return (
    <>
      <button
        type="button"
        className="control-btn"
        data-active={anchor ? true : undefined}
        aria-pressed={!!anchor}
        aria-expanded={!!anchor}
        aria-label={label}
        title={label}
        disabled={!connected}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <AudioLines />
      </button>
      {anchor && connected && <SoundboardPanel anchor={anchor} onClose={close} />}
    </>
  );
}

function SoundboardPanel({ anchor, onClose }: { anchor: HTMLElement; onClose(): void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"grid" | "add">("grid");
  const [pos, setPos] = useState(() => place(anchor));
  useLayoutEffect(() => setPos(place(anchor)), [anchor]);

  // Fecha ao clicar fora (o seletor de emoji, que abre por cima, conta como dentro) ou no Esc.
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const t = e.target as Element;
      if (panel.current?.contains(t) || anchor.contains(t) || t.closest?.(".emoji-picker")) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        onClose();
        anchor.focus();
      }
    };
    const resize = () => setPos(place(anchor));
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", resize);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div ref={panel} className="soundboard" role="dialog" aria-label="Mesa de sons" style={pos}>
      {mode === "grid" ? <SoundGrid onAdd={() => setMode("add")} /> : <AddSound onDone={() => setMode("grid")} />}
    </div>,
    document.body,
  );
}

function SoundGrid({ onAdd }: { onAdd(): void }) {
  const sounds = useApp((s) => s.sounds);
  const me = useApp((s) => s.me);
  const enabled = useSettings((s) => s.soundboardEnabled);
  const volume = useSettings((s) => s.soundboardVolume);
  const deafened = useVoice((s) => s.deafened);
  const [cooling, setCooling] = useState(false);
  const isAdmin = !!me && me.role === "admin";

  function play(sound: SoundboardSound) {
    if (!requestSound(sound.id)) return;
    setCooling(true);
    setTimeout(() => setCooling(false), LIMITS.soundboardCooldownMs);
  }

  async function remove(sound: SoundboardSound) {
    if (!confirm(`Apagar o som "${sound.name}" para todo mundo?`)) return;
    try {
      await api.deleteSound(sound.id);
      useApp.setState((s) => ({ sounds: s.sounds.filter((x) => x.id !== sound.id) }));
    } catch (err) {
      toast.fromError(err, "Não foi possível apagar o som");
    }
  }

  const full = sounds.length >= LIMITS.soundsMax;

  return (
    <>
      <header className="soundboard-head">
        <h2>Mesa de sons</h2>
        <label className="soundboard-volume" title="Volume da mesa de sons (só para você)">
          <span className="sr-only">Volume da mesa de sons</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            disabled={!enabled}
            onChange={(e) => useSettings.getState().set({ soundboardVolume: Number(e.target.value) })}
          />
          <span aria-hidden="true">{Math.round(volume * 100)}%</span>
        </label>
      </header>

      {!enabled ? (
        <p className="soundboard-note">
          Você desligou os sons da mesa: os outros ouvem o que você tocar, mas você não ouve nada.{" "}
          <button type="button" className="link-btn" onClick={() => useSettings.getState().set({ soundboardEnabled: true })}>
            Ligar de novo
          </button>
        </p>
      ) : deafened ? (
        <p className="soundboard-note">Você está ensurdecido: os sons tocam para a turma, mas não para você.</p>
      ) : null}

      {sounds.length === 0 ? (
        <p className="soundboard-empty muted">
          Nenhum som ainda. Adicione o primeiro: um trecho de até {LIMITS.soundMaxSeconds} segundos que toca para todo mundo da
          chamada.
        </p>
      ) : (
        <ul className="sound-grid" data-cooling={cooling || undefined}>
          {sounds.map((sound) => {
            const canDelete = isAdmin || (!!me && sound.uploaderId === me.id);
            return (
              <li key={sound.id} className="sound-item">
                <button
                  type="button"
                  className="sound-btn"
                  disabled={cooling}
                  onClick={() => play(sound)}
                  title={`Tocar "${sound.name}" para a chamada`}
                >
                  <span className="sound-emoji" aria-hidden="true">
                    {sound.emoji}
                  </span>
                  <span className="sound-name">{sound.name}</span>
                </button>
                {canDelete && (
                  <button
                    type="button"
                    className="icon-btn sound-del"
                    onClick={() => void remove(sound)}
                    aria-label={`Apagar o som ${sound.name}`}
                    title="Apagar"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <footer className="soundboard-foot">
        <button type="button" className="btn btn-small" disabled={full} onClick={onAdd}>
          <Plus size={14} aria-hidden="true" /> Adicionar som
        </button>
        {full && <small className="muted">Limite de {LIMITS.soundsMax} sons: apague algum para adicionar.</small>}
      </footer>
    </>
  );
}

interface Source {
  file: File;
  buffer: AudioBuffer;
  peaks: number[];
}

const PEAK_COLUMNS = 120;

function AddSound({ onDone }: { onDone(): void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [reading, setReading] = useState(false);
  const [start, setStart] = useState(0);
  const [name, setName] = useState("");
  /** A pessoa digitou o nome: trocar de arquivo não sobrescreve. */
  const [nameEdited, setNameEdited] = useState(false);
  const [emoji, setEmoji] = useState("🔊");
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState<AudioBufferSourceNode | null>(null);

  const duration = source?.buffer.duration ?? 0;
  /** Só áudio mais longo que o limite tem trecho para escolher; o curto só perde o silêncio do começo. */
  const maxStart = Math.max(0, duration - LIMITS.soundMaxSeconds);
  const clipLen = Math.min(LIMITS.soundMaxSeconds, duration - start);
  const clamp = (t: number) => Math.min(maxStart, Math.max(0, t));

  useEffect(() => () => previewing?.stop(), [previewing]);

  async function choose(file: File) {
    setReading(true);
    stopPreview();
    try {
      const buffer = await decodeSource(file);
      if (buffer.duration < 0.15) throw new Error("Esse áudio é curto demais.");
      const overview = await monoOverview(buffer);
      const silence = firstSoundAt(overview, 8_000);
      const long = buffer.duration > LIMITS.soundMaxSeconds;
      const begin = long ? Math.min(silence, buffer.duration - LIMITS.soundMaxSeconds) : Math.min(silence, buffer.duration - 0.15);
      setSource({ file, buffer, peaks: waveformPeaks(overview, PEAK_COLUMNS) });
      setStart(begin);
      if (!nameEdited) {
        setName(file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, LIMITS.soundNameMax));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui ler esse arquivo.");
    } finally {
      setReading(false);
    }
  }

  function stopPreview() {
    previewing?.stop();
    setPreviewing(null);
  }

  async function preview() {
    if (!source) return;
    if (previewing) return stopPreview();
    const { samples } = await buildClip(source.buffer, start);
    const ctx = soundboardAudio();
    const buf = ctx.createBuffer(1, samples.length, CLIP_SAMPLE_RATE);
    buf.copyToChannel(samples, 0);
    const node = playBuffer(buf);
    node.addEventListener("ended", () => setPreviewing((p) => (p === node ? null : p)));
    setPreviewing(node);
  }

  async function save() {
    if (!source || !name.trim()) return;
    setSaving(true);
    stopPreview();
    try {
      const { blob } = await buildClip(source.buffer, start);
      const { sound } = await api.uploadSound(blob, name.trim(), emoji);
      useApp.setState((s) => ({ sounds: [...s.sounds.filter((x) => x.id !== sound.id), sound] }));
      toast.info(`"${sound.name}" está na mesa de sons.`);
      onDone();
    } catch (err) {
      toast.fromError(err, "Não foi possível salvar o som");
    } finally {
      setSaving(false);
    }
  }

  const fmt = (t: number) => `${t.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;

  return (
    <div className="sound-add">
      <header className="soundboard-head">
        <button type="button" className="icon-btn" onClick={onDone} aria-label="Voltar para a mesa de sons" title="Voltar">
          <ArrowLeft size={18} />
        </button>
        <h2>Adicionar som</h2>
      </header>

      <input
        ref={fileInput}
        type="file"
        hidden
        accept="audio/*,video/mp4,video/webm,.mp3,.wav,.ogg,.m4a,.opus,.flac"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void choose(file);
        }}
      />

      {!source ? (
        <div className="sound-drop">
          <button type="button" className="btn" disabled={reading} onClick={() => fileInput.current?.click()}>
            <Upload size={16} aria-hidden="true" /> {reading ? "Lendo o áudio…" : "Escolher arquivo de áudio"}
          </button>
          <small className="muted">
            MP3, WAV, OGG, M4A ou o som de um vídeo MP4 (até 8 MB). Se for mais longo que {LIMITS.soundMaxSeconds} s, você
            escolhe o trecho.
          </small>
        </div>
      ) : (
        <>
          <Waveform
            peaks={source.peaks}
            start={duration ? start / duration : 0}
            span={duration ? clipLen / duration : 1}
            onSeek={(f) => {
              if (maxStart === 0) return; // áudio curto: nada para escolher
              stopPreview();
              setStart(clamp(f * duration - clipLen / 2));
            }}
          />
          {maxStart > 0 ? (
            <label className="field">
              <span>
                Trecho: {fmt(start)} a {fmt(start + clipLen)} (de {fmt(duration)})
              </span>
              <input
                type="range"
                min={0}
                max={maxStart}
                step={0.05}
                value={start}
                onChange={(e) => {
                  stopPreview();
                  setStart(Number(e.target.value));
                }}
              />
            </label>
          ) : (
            <p className="muted small-note">
              Duração: {fmt(clipLen)}
              {start > 0.05 ? " (o silêncio do começo foi cortado)" : ""}
            </p>
          )}

          <div className="sound-add-row">
            <button
              type="button"
              className="icon-btn sound-emoji-pick"
              onClick={(e) => setPicker(picker ? null : e.currentTarget)}
              aria-label={`Emoji do som: ${emoji}. Trocar`}
              title="Trocar o emoji"
            >
              {emoji}
            </button>
            <label className="field sound-name-field">
              <span className="sr-only">Nome do som</span>
              <input
                value={name}
                maxLength={LIMITS.soundNameMax}
                placeholder="Nome do som"
                onChange={(e) => {
                  setName(e.target.value);
                  setNameEdited(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void save();
                }}
              />
            </label>
          </div>

          <div className="sound-add-actions">
            <button type="button" className="btn btn-small" onClick={() => void preview()}>
              {previewing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
              {previewing ? "Parar" : "Ouvir"}
            </button>
            <button type="button" className="btn btn-small btn-ghost" disabled={reading} onClick={() => fileInput.current?.click()}>
              Outro arquivo
            </button>
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={saving || !name.trim()}
              onClick={() => void save()}
            >
              {saving ? "Salvando…" : "Salvar som"}
            </button>
          </div>
          <small className="muted">O volume é igualado automaticamente, para nenhum som estourar no ouvido da turma.</small>
        </>
      )}

      {picker && (
        <EmojiPicker
          anchor={picker}
          onClose={() => setPicker(null)}
          onPick={(e) => {
            setEmoji(e);
            rememberEmoji(e);
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}

/** Onda do arquivo com o trecho escolhido em destaque; clicar move o trecho para ali. */
function Waveform({
  peaks,
  start,
  span,
  onSeek,
}: {
  peaks: number[];
  /** Início e tamanho do trecho, de 0 a 1. */
  start: number;
  span: number;
  onSeek(fraction: number): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext("2d");
    if (!el || !g) return;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth;
    const h = el.clientHeight;
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    g.scale(dpr, dpr);
    const style = getComputedStyle(el);
    const on = style.getPropertyValue("--wave-on").trim() || "#f2a93b";
    const off = style.getPropertyValue("--wave-off").trim() || "#6f8792";
    const col = w / peaks.length;
    peaks.forEach((p, i) => {
      const x = i * col;
      const f = (i + 0.5) / peaks.length;
      g.fillStyle = f >= start && f <= start + span ? on : off;
      const bar = Math.max(2, p * (h - 4));
      g.fillRect(x + col * 0.15, (h - bar) / 2, Math.max(1, col * 0.7), bar);
    });
  }, [peaks, start, span]);

  return (
    <div className="waveform">
      <canvas
        ref={canvas}
        aria-hidden="true"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onSeek((e.clientX - r.left) / r.width);
        }}
      />
      <span className="waveform-window" style={{ left: `${start * 100}%`, width: `${span * 100}%` }} aria-hidden="true" />
    </div>
  );
}
