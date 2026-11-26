import comemorando from "../assets/mascote/comemorando.webp";
import desconfiado from "../assets/mascote/desconfiado.webp";
import dormindo from "../assets/mascote/dormindo.webp";
import guarana from "../assets/mascote/guarana.webp";
import piscando from "../assets/mascote/piscando.webp";
import rindo from "../assets/mascote/rindo.webp";
import surpreso from "../assets/mascote/surpreso.webp";
import { parseStickerMessage } from "./plain.ts";

export interface Sticker {
  id: string;
  name: string;
  src: string;
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

export function stickerFromMessage(content: string): Sticker | undefined {
  const id = parseStickerMessage(content);
  return id ? STICKERS.find((s) => s.id === id) : undefined;
}
