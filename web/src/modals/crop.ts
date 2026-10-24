/**
 * Matemática do recorte quadrado da foto de perfil (testável, sem DOM).
 * A imagem cobre sempre o quadro inteiro: dá para arrastar e aproximar, mas nunca
 * sobra fundo vazio no recorte.
 */
export interface Crop {
  /** Canto superior esquerdo da imagem em relação ao quadro, em px do quadro (<= 0). */
  x: number;
  y: number;
  /** 1 = a imagem só cobre o quadro; até MAX_ZOOM. */
  zoom: number;
}

export const MAX_ZOOM = 4;

const coverScale = (w: number, h: number, view: number) => Math.max(view / w, view / h);
export const scaleOf = (c: Crop, w: number, h: number, view: number) => coverScale(w, h, view) * c.zoom;

function clampCrop(c: Crop, w: number, h: number, view: number): Crop {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, c.zoom));
  const scale = coverScale(w, h, view) * zoom;
  const clamp = (v: number, size: number) => Math.min(0, Math.max(view - size * scale, v));
  return { zoom, x: clamp(c.x, w), y: clamp(c.y, h) };
}

/** Começa centralizado, sem zoom. */
export function initialCrop(w: number, h: number, view: number): Crop {
  const scale = coverScale(w, h, view);
  return { zoom: 1, x: (view - w * scale) / 2, y: (view - h * scale) / 2 };
}

export function moveCrop(c: Crop, dx: number, dy: number, w: number, h: number, view: number): Crop {
  return clampCrop({ ...c, x: c.x + dx, y: c.y + dy }, w, h, view);
}

/** Zoom mantendo fixo o ponto no centro do quadro. */
export function zoomCrop(c: Crop, zoom: number, w: number, h: number, view: number): Crop {
  const before = scaleOf(c, w, h, view);
  const target = clampCrop({ ...c, zoom }, w, h, view).zoom;
  const after = coverScale(w, h, view) * target;
  const cx = (view / 2 - c.x) / before;
  const cy = (view / 2 - c.y) / before;
  return clampCrop({ zoom: target, x: view / 2 - cx * after, y: view / 2 - cy * after }, w, h, view);
}

/** Retângulo (quadrado) da imagem original que vai para a foto final. */
export function sourceRect(c: Crop, w: number, h: number, view: number): { sx: number; sy: number; size: number } {
  const scale = scaleOf(c, w, h, view);
  // "+ 0" troca -0 por 0 (canto encostado na borda)
  return { sx: -c.x / scale + 0, sy: -c.y / scale + 0, size: view / scale };
}
