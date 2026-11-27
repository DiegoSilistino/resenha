/** O que o app de desktop (Electron, pasta desktop/) oferece ao site. No navegador não existe. */
export interface DesktopBridge {
  /** Tecla do push-to-talk (KeyboardEvent.code) para o atalho global; null desliga. */
  setPushToTalkKey(code: string | null): void;
  /** Tecla do push-to-talk apertada ou solta com outra janela em foco. Devolve como parar de ouvir. */
  onPushToTalk(cb: (down: boolean) => void): () => void;
  /** Traz a janela (minimizada ou na bandeja); `focus: false` mostra sem roubar o foco do jogo. */
  show(focus: boolean): void;
  /** Telas e janelas abertas, com miniatura. Opcional: só o app 1.1.0 em diante tem. */
  listScreenSources?(): Promise<ScreenSource[]>;
  /** Avisa o app o que transmitir no próximo pedido (aí ele não mostra o menu dele). */
  chooseScreenSource?(id: string): Promise<void>;
  /** Versão do app e a nova que já baixou (null: nenhuma). Opcional: só o app 1.2.0 em diante tem. */
  appUpdateStatus?(): Promise<{ version: string; ready: string | null } | null>;
  /** Avisa quando terminou de baixar uma versão nova. Devolve como parar de ouvir. */
  onAppUpdateReady?(cb: (version: string) => void): () => void;
  /** Fecha, instala a versão baixada por cima (as configurações ficam) e abre de novo. */
  installAppUpdate?(): void;
  /** O app abre junto com o Windows (escondido na bandeja)? Opcional: só o app 1.3.0 em diante tem. */
  getOpenAtLogin?(): Promise<boolean>;
  setOpenAtLogin?(on: boolean): Promise<void>;
}

export interface ScreenSource {
  id: string;
  name: string;
  /** Tela inteira (senão é a janela de um app). */
  screen: boolean;
  /** Miniatura (data URL); null quando o Windows não deu imagem. */
  thumbnail: string | null;
  icon: string | null;
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
