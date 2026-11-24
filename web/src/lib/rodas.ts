import { useApp } from "../state/app.ts";

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
