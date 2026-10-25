/**
 * Partes do site carregadas sob demanda têm o nome com hash; depois de uma atualização
 * do servidor, uma aba aberta antes dela procura arquivos que já não existem. Nesse
 * caso a página recarrega sozinha (uma vez por minuto, para nunca entrar em loop).
 */
import { lazy, type ComponentType } from "react";

const RELOAD_KEY = "resenha-reload-por-atualizacao";

function reloadedRecently(): boolean {
  try {
    return Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) < 60_000;
  } catch {
    return true; // sem sessionStorage, não arrisca recarregar em loop
  }
}

/** Erro de "arquivo da versão antiga sumiu" (cada navegador escreve de um jeito). */
export function isStaleChunkError(err: unknown): boolean {
  const msg = String((err as Error | undefined)?.message ?? err);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch/i.test(msg);
}

/** Carrega um pedaço do app; se for a versão antiga sumindo, recarrega a página na versão nova. */
export async function loadChunk<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (err) {
    if (isStaleChunkError(err) && !reloadedRecently()) {
      try {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      } catch {
        // segue para o reload mesmo assim
      }
      location.reload();
      return new Promise<T>(() => undefined); // a página está recarregando
    }
    throw err;
  }
}

/** React.lazy com a proteção acima. */
export function lazyChunk<P extends object>(loader: () => Promise<ComponentType<P>>) {
  return lazy(async () => ({ default: await loadChunk(loader) }));
}
