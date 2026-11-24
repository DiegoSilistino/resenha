import { useRef, useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { LIMITS, type ProfileLook } from "@resenha/shared";
import { GifPicker } from "../chat/GifPicker.tsx";
import { bannerImageStyle } from "../lib/look.ts";
import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";

/** Capa escolhida mas ainda não salva: um GIF do GIPHY ou um arquivo do computador. */
export type PendingBanner = { kind: "gif"; url: string } | { kind: "file"; file: File; url: string };
/** Que pedaço da capa aparece e o zoom (perfil e roda usam a mesma conta). */
export type BannerPos = Pick<ProfileLook, "bannerX" | "bannerY" | "bannerZoom">;

/**
 * Botões da capa (perfil e roda). Escolher só põe a imagem na prévia (dá para ajustar antes);
 * ela vai de vez no "Salvar". "Tirar a imagem" apaga a capa salva na hora.
 */
export function BannerPicker({
  hasSaved,
  pending,
  onPick,
  onDiscard,
  onRemove,
}: {
  hasSaved: boolean;
  pending: boolean;
  onPick(p: PendingBanner): void;
  onDiscard(): void;
  onRemove(): Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [gifAnchor, setGifAnchor] = useState<HTMLElement | null>(null);
  const gifs = useApp((s) => s.features.gifs);
  const maxMb = LIMITS.bannerMaxBytes / 1024 / 1024;

  async function remove() {
    setBusy(true);
    try {
      await onRemove();
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row-actions">
      {gifs && (
        <button
          type="button"
          className="btn btn-small btn-primary"
          aria-expanded={!!gifAnchor}
          onClick={(e) => setGifAnchor(gifAnchor ? null : e.currentTarget)}
        >
          Escolher GIF
        </button>
      )}
      <label className="btn btn-small btn-outline">
        {gifs ? "Enviar do computador" : "Escolher imagem ou GIF"}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (file.size > LIMITS.bannerMaxBytes) return toast.error(`A capa pode ter no máximo ${maxMb} MB.`);
            onPick({ kind: "file", file, url: URL.createObjectURL(file) });
          }}
        />
      </label>
      {pending ? (
        <button type="button" className="btn btn-small btn-ghost" onClick={onDiscard}>
          Descartar
        </button>
      ) : (
        hasSaved && (
          <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => void remove()}>
            Tirar a imagem
          </button>
        )
      )}
      <small className="muted">
        {gifs && "Escolha um GIF ou envie "}PNG, JPEG, WebP ou GIF, até {maxMb} MB.
      </small>
      {gifAnchor && (
        <GifPicker
          anchor={gifAnchor}
          onClose={() => setGifAnchor(null)}
          onPick={(g) => {
            setGifAnchor(null);
            onPick({ kind: "gif", url: g.imageUrl });
          }}
        />
      )}
    </div>
  );
}

const clampPct = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
/** Setas no editor da capa: movem a imagem para aquele lado. */
const ARROW_STEP: Record<string, [number, number]> = { ArrowLeft: [2, 0], ArrowRight: [-2, 0], ArrowUp: [0, 2], ArrowDown: [0, -2] };

/** Quadro da capa: arrastar escolhe o pedaço que aparece; o zoom aproxima a partir dele. `wide` é o formato da faixa da roda. */
export function BannerEditor({
  src,
  pos,
  onChange,
  hint,
  wide = false,
}: {
  src: string;
  pos: BannerPos;
  onChange(p: Partial<BannerPos>): void;
  hint: string;
  wide?: boolean;
}) {
  const natural = useRef({ w: 0, h: 0 });
  const drag = useRef<{ x0: number; y0: number; bx: number; by: number } | null>(null);

  function dragTo(el: HTMLElement, dx: number, dy: number, from: { bx: number; by: number }) {
    const { w, h } = natural.current;
    if (!w || !h) return;
    const scale = Math.max(el.clientWidth / w, el.clientHeight / h) * pos.bannerZoom;
    // a sobra da imagem fora do quadro: arrastar a sobra inteira leva de uma borda à outra (100% a 0%)
    const slackX = w * scale - el.clientWidth;
    const slackY = h * scale - el.clientHeight;
    onChange({
      bannerX: slackX > 1 ? clampPct(from.bx - (dx / slackX) * 100) : from.bx,
      bannerY: slackY > 1 ? clampPct(from.by - (dy / slackY) * 100) : from.by,
    });
  }

  return (
    <div className="field">
      <div
        className="banner-editor"
        data-wide={wide || undefined}
        tabIndex={0}
        aria-label="Posição da capa: arraste ou use as setas"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x0: e.clientX, y0: e.clientY, bx: pos.bannerX, by: pos.bannerY };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) dragTo(e.currentTarget, e.clientX - d.x0, e.clientY - d.y0, d);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={(e) => {
          const step = ARROW_STEP[e.key];
          if (!step) return;
          e.preventDefault();
          onChange({ bannerX: clampPct(pos.bannerX + step[0]), bannerY: clampPct(pos.bannerY + step[1]) });
        }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          style={bannerImageStyle(pos)}
          onLoad={(e) => (natural.current = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
      </div>
      <label className="banner-zoom">
        <ZoomOut size={16} aria-hidden="true" />
        <input
          type="range"
          min={1}
          max={3}
          step={0.05}
          value={pos.bannerZoom}
          aria-label="Zoom da capa"
          onChange={(e) => onChange({ bannerZoom: Number(e.target.value) })}
        />
        <ZoomIn size={16} aria-hidden="true" />
      </label>
      <small>{hint}</small>
    </div>
  );
}
