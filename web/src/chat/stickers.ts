import comemorando from "../assets/mascote/comemorando.webp";
import desconfiado from "../assets/mascote/desconfiado.webp";
import dormindo from "../assets/mascote/dormindo.webp";
import guarana from "../assets/mascote/guarana.webp";
import piscando from "../assets/mascote/piscando.webp";
import rindo from "../assets/mascote/rindo.webp";
import surpreso from "../assets/mascote/surpreso.webp";
import { api } from "../lib/api.ts";
import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";
import { parseStickerMessage } from "./plain.ts";

export interface Sticker {
  id: string;
  name: string;
  src: string;
  /** Criada por alguém (dá para favoritar); as do caramelo já vêm com o app. */
  custom?: boolean;
}

/** Figurinhas do caramelo. A mensagem guarda só o id: nunca troque um id, senão as já enviadas viram texto. */
export const STICKERS: readonly Sticker[] = [
  { id: "rindo", name: "Rindo", src: rindo },
  { id: "piscando", name: "Piscando", src: piscando },
  { id: "surpreso", name: "Surpreso", src: surpreso },
  { id: "desconfiado", name: "Desconfiado", src: desconfiado },
  { id: "comemorando", name: "Comemorando", src: comemorando },
  { id: "dormindo", name: "Dormindo", src: dormindo },
  { id: "brinde", name: "Brinde", src: guarana },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Figurinha que alguém criou: a imagem mora com as fotos. */
export const customSticker = (id: string): Sticker => ({ id, name: "Figurinha", src: `/api/avatars/${id}`, custom: true });

export function stickerFromMessage(content: string): Sticker | undefined {
  const id = parseStickerMessage(content);
  if (!id) return undefined;
  return STICKERS.find((s) => s.id === id) ?? (UUID.test(id) ? customSticker(id) : undefined);
}

/** Estrela: põe nas suas figurinhas ou tira. A lista nova chega pelo servidor, em todos os seus aparelhos. */
export async function toggleStickerFavorite(id: string): Promise<void> {
  const saved = useApp.getState().stickers.includes(id);
  try {
    await (saved ? api.unfavoriteSticker(id) : api.favoriteSticker(id));
  } catch (err) {
    toast.fromError(err, "Não foi possível mudar suas figurinhas");
  }
}
