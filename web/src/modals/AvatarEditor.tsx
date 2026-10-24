import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { api } from "../lib/api.ts";
import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";
import { initialCrop, MAX_ZOOM, moveCrop, scaleOf, sourceRect, zoomCrop, type Crop } from "./crop.ts";

const VIEW = 240;
/** Tamanho final: nítido até no maior avatar do app (72 px) em telas 3x. */
const OUT = 256;

interface Loaded {
  url: string;
  img: HTMLImageElement;
  w: number;
  h: number;
}

/** Recorte quadrado no navegador: a foto já chega pequena ao servidor (~20 KB). */
async function renderCrop(img: HTMLImageElement, crop: Crop, w: number, h: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = OUT;
  canvas.height = OUT;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("canvas indisponível");
  g.imageSmoothingQuality = "high";
  const { sx, sy, size } = sourceRect(crop, w, h, VIEW);
  g.drawImage(img, sx, sy, size, size, 0, 0, OUT, OUT);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
  if (blob) return blob;
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) throw new Error("não foi possível gerar a imagem");
  return png;
}

export function AvatarEditor({ onDone }: { onDone(): void }) {
  const me = useApp((s) => s.me);
  const input = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const view = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    if (loaded) URL.revokeObjectURL(loaded.url);
  }, [loaded]);

  // Rodinha do mouse dá zoom. Ouvinte nativo (não passivo) para a página não rolar junto.
  useEffect(() => {
    const el = view.current;
    if (!el || !loaded) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setCrop((c) => (c ? zoomCrop(c, c.zoom * factor, loaded.w, loaded.h, VIEW) : c));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [loaded]);

  if (!me) return null;

  function pick(file: File | undefined) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w < 32 || h < 32) {
        URL.revokeObjectURL(url);
        toast.error("Essa imagem é pequena demais. Use uma com pelo menos 32 pixels de lado.");
        return;
      }
      setLoaded({ url, img, w, h });
      setCrop(initialCrop(w, h, VIEW));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast.error("Não consegui abrir essa imagem. Use uma foto JPG, PNG ou WebP.");
    };
    img.src = url;
  }

  async function save() {
    if (!loaded || !crop) return;
    setBusy(true);
    try {
      const blob = await renderCrop(loaded.img, crop, loaded.w, loaded.h);
      const { me: updated } = await api.uploadAvatar(blob);
      useApp.getState().setMe(updated);
      toast.info("Foto atualizada.");
      setLoaded(null);
      setCrop(null);
      onDone();
    } catch (err) {
      toast.fromError(err, "Não foi possível enviar a foto");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const { me: updated } = await api.removeAvatar();
      useApp.getState().setMe(updated);
      toast.info("Foto removida. Agora aparecem suas iniciais.");
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || !loaded || !crop) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setCrop(moveCrop(crop, dx, dy, loaded.w, loaded.h, VIEW));
  };
  const endDrag = () => {
    drag.current = null;
  };
  // Setas também posicionam (acessível sem mouse).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!loaded || !crop) return;
    const step = e.shiftKey ? 30 : 8;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    setCrop(moveCrop(crop, m[0], m[1], loaded.w, loaded.h, VIEW));
  };

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept="image/png,image/jpeg,image/webp"
      hidden
      onChange={(e) => {
        pick(e.target.files?.[0]);
        e.target.value = ""; // escolher o mesmo arquivo de novo também dispara
      }}
    />
  );

  if (!loaded || !crop) {
    return (
      <div className="row-actions">
        {fileInput}
        <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>
          <ImagePlus size={16} aria-hidden="true" /> {me.avatarUrl ? "Trocar foto" : "Enviar foto"}
        </button>
        {me.avatarUrl && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void remove()}>
            <Trash2 size={16} aria-hidden="true" /> Remover foto
          </button>
        )}
      </div>
    );
  }

  const scale = scaleOf(crop, loaded.w, loaded.h, VIEW);
  return (
    <div className="avatar-editor">
      {fileInput}
      <div
        ref={view}
        className="crop-view"
        style={{ width: VIEW, height: VIEW }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="img"
        aria-label="Prévia do recorte. Arraste ou use as setas para posicionar; a rodinha do mouse dá zoom."
      >
        <img
          src={loaded.url}
          alt=""
          draggable={false}
          style={{ width: loaded.w * scale, height: loaded.h * scale, transform: `translate(${crop.x}px, ${crop.y}px)` }}
        />
        <span className="crop-mask" aria-hidden="true" />
      </div>
      <label className="field">
        <span>Zoom</span>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={crop.zoom}
          onChange={(e) => setCrop(zoomCrop(crop, Number(e.target.value), loaded.w, loaded.h, VIEW))}
        />
        <small>Arraste a foto para escolher o enquadramento.</small>
      </label>
      <div className="row-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Enviando…" : "Usar esta foto"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => {
            setLoaded(null);
            setCrop(null);
          }}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
