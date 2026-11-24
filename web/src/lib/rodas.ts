import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";
import { api } from "./api.ts";

/** Tira `id` da lista e põe logo antes (ou depois) de `targetId`. */
export function reorderIds(ids: string[], id: string, targetId: string, after: boolean): string[] {
  if (id === targetId) return ids;
  const rest = ids.filter((x) => x !== id);
  const at = rest.indexOf(targetId) + (after ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** Move a sala na tela na hora e salva a ordem; se o servidor recusar, volta como estava. */
export async function moveRoom(rodaId: string, id: string, targetId: string, after: boolean) {
  const { channels, applyEvent } = useApp.getState();
  const before = channels.filter((c) => c.rodaId === rodaId);
  const ids = reorderIds(before.map((c) => c.id), id, targetId, after);
  if (ids.every((x, i) => x === before[i]!.id)) return;
  ids.forEach((cid, position) => applyEvent({ type: "channel.upsert", channel: { ...before.find((c) => c.id === cid)!, position } }));
  try {
    await api.reorderRooms(rodaId, ids);
  } catch (err) {
    for (const channel of before) applyEvent({ type: "channel.upsert", channel });
    toast.fromError(err);
  }
}

/**
 * Espera a roda aparecer no estado (o servidor manda um "hello" novo depois de entrar ou criar).
 * Evita abrir a página da roda antes de ela chegar, o que mandaria a pessoa de volta para a lista.
 */
export function waitForRoda(id: string, timeoutMs = 4_000): Promise<boolean> {
  if (useApp.getState().rodas[id]) return Promise.resolve(true);
  return new Promise((resolve) => {
    const unsub = useApp.subscribe((s) => {
      if (!s.rodas[id]) return;
      clearTimeout(timer);
      unsub();
      resolve(true);
    });
    const timer = setTimeout(() => {
      unsub();
      resolve(false);
    }, timeoutMs);
  });
}
