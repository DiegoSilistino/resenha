/**
 * Manda falhas do navegador para o painel de erros do admin (Administrar → Erros).
 * Só o necessário para entender o problema: tipo, mensagem que a pessoa viu, detalhe
 * técnico e a situação (página, voz, redução de ruído). Nada de conteúdo de conversa.
 */
import type { ClientErrorKind } from "@resenha/shared";
import { useSettings } from "../state/settings.ts";
import { useVoice } from "../voice/state.ts";

/** O mesmo erro repetido em menos disso conta uma vez só. */
const DEDUPE_MS = 60_000;
const recent = new Map<string, number>();
/** Página fechando ou recarregando: o que falhar agora é efeito disso, não erro de verdade. */
let leaving = false;

function describe(err: unknown): string {
  if (!err) return "";
  if (err instanceof Error) return `${err.name}: ${err.message}`.slice(0, 1_500);
  if (typeof err === "object") {
    try {
      return JSON.stringify(err).slice(0, 1_500);
    } catch {
      return String(err);
    }
  }
  return String(err).slice(0, 1_500);
}

export function reportError(
  kind: ClientErrorKind,
  message: string,
  err?: unknown,
  extra: Record<string, string | number | boolean> = {},
): void {
  if (leaving) return;
  const detail = describe(err);
  const key = `${kind}|${message}|${detail}`;
  const now = Date.now();
  if (now - (recent.get(key) ?? 0) < DEDUPE_MS) return;
  recent.set(key, now);

  const v = useVoice.getState();
  const s = useSettings.getState();
  const context = {
    pagina: location.pathname.slice(0, 80),
    voz: v.status,
    ruido: s.noiseMode,
    pushToTalk: s.pttEnabled,
    ...extra,
  };
  void fetch("/api/client-errors", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, message: message.slice(0, 500), detail, context }),
  }).catch(() => undefined);
}

/** Erros inesperados do próprio app (nunca de extensões do navegador). */
function fromOurCode(source: string | undefined, stack: string | undefined): boolean {
  const here = location.origin;
  return (!!source && source.startsWith(here)) || (!!stack && stack.includes(`${here}/assets/`));
}

/** Ruído conhecido e inofensivo que não vale incomodar o admin. */
const IGNORED = /ResizeObserver loop|AbortError|The play\(\) request was interrupted|NotAllowedError: play\(\) failed/i;

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => (leaving = true));
  // voltou do cache de páginas (botão voltar): conta de novo
  window.addEventListener("pageshow", () => (leaving = false));
  window.addEventListener("error", (e) => {
    const err = e.error as Error | undefined;
    if (IGNORED.test(String(e.message)) || !fromOurCode(e.filename, err?.stack)) return;
    reportError("inesperado", "Erro inesperado no app", err ?? e.message, { arquivo: (e.filename ?? "").split("/").pop() ?? "" });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const err = e.reason as Error | undefined;
    if (IGNORED.test(describe(err)) || !fromOurCode(undefined, err?.stack)) return;
    reportError("inesperado", "Erro inesperado no app (promessa)", err);
  });
}
