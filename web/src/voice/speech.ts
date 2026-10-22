/**
 * Reconhecimento de fala do navegador (Web Speech API) para legendas.
 * Cada pessoa transcreve só o PRÓPRIO microfone e envia o texto pela sala:
 * não há custo de servidor. Funciona no Chrome e no Edge; o Firefox não suporta.
 * Atenção: no Chrome o áudio é processado pelo Google; no Edge, pela Microsoft.
 */

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = () => typeof window !== "undefined" && getCtor() !== null;

export interface CaptionChunk {
  text: string;
  final: boolean;
}

/**
 * Mantém o reconhecimento rodando enquanto `active` for verdadeiro.
 * O navegador encerra sozinho após silêncio; reiniciamos automaticamente.
 */
export class SpeechCaptioner {
  private recognition: SpeechRecognitionLike | null = null;
  private active = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;

  constructor(
    private readonly onChunk: (chunk: CaptionChunk) => void,
    private readonly onFatal: (message: string) => void,
  ) {}

  setActive(active: boolean, lang: string): void {
    if (active === this.active && (!active || this.recognition?.lang === lang)) return;
    this.active = active;
    this.stopRecognition();
    if (active) this.startRecognition(lang);
  }

  private startRecognition(lang: string): void {
    const Ctor = getCtor();
    if (!Ctor) {
      this.active = false;
      this.onFatal("Seu navegador não tem reconhecimento de fala. Use Chrome ou Edge para gerar legendas.");
      return;
    }
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      this.failures = 0;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]!;
        const text = result[0]?.transcript.trim() ?? "";
        if (text) this.onChunk({ text, final: result.isFinal });
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.active = false;
        this.onFatal("O navegador bloqueou o reconhecimento de fala. Libere o microfone para este site.");
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        this.failures++;
      }
    };
    rec.onend = () => {
      if (this.recognition !== rec) return;
      this.recognition = null;
      if (!this.active) return;
      if (this.failures >= 5) {
        this.active = false;
        this.onFatal("O reconhecimento de fala parou de responder. Desligue e ligue as legendas.");
        return;
      }
      // pequeno atraso evita loop apertado quando o serviço falha em sequência
      this.restartTimer = setTimeout(() => this.startRecognition(lang), 250 * (this.failures + 1));
    };
    this.recognition = rec;
    try {
      rec.start();
    } catch {
      // start() lança se já estiver rodando; o onend cuida do reinício
    }
  }

  private stopRecognition(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const rec = this.recognition;
    this.recognition = null;
    rec?.abort();
  }
}
