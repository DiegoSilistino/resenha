/** O que o app de desktop (Electron, pasta desktop/) oferece ao site. No navegador não existe. */
export interface DesktopBridge {
  /** Tecla do push-to-talk (KeyboardEvent.code) para o atalho global; null desliga. */
  setPushToTalkKey(code: string | null): void;
  /** Tecla do push-to-talk apertada ou solta com outra janela em foco. Devolve como parar de ouvir. */
  onPushToTalk(cb: (down: boolean) => void): () => void;
  /** Traz a janela (minimizada ou na bandeja); `focus: false` mostra sem roubar o foco do jogo. */
  show(focus: boolean): void;
}

export const desktop: DesktopBridge | undefined = (globalThis as { resenhaDesktop?: DesktopBridge }).resenhaDesktop;

/** Instalador gerado pelo GitHub Actions (.github/workflows/desktop.yml) a cada versão do app. */
export const DESKTOP_DOWNLOAD_URL = "https://github.com/DiegoSilistino/resenha/releases/latest/download/Resenha-Setup.exe";

/** Oferece o download no Windows, fora do próprio app. */
export const offerDesktopApp = !desktop && typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent);

/** Clique numa notificação: no app, a janela pode estar escondida na bandeja. */
export function focusApp(): void {
  desktop?.show(true);
  window.focus();
}
