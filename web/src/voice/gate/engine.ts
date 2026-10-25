/**
 * Lógica do "portão" do microfone (sensibilidade), sem nada de navegador: roda dentro
 * do AudioWorklet e nos testes. Recebe o volume de cada bloco de áudio e decide se o
 * som passa.
 *
 * - Abre quando o volume fica acima do limiar por `confirmMs` (um estalo de tecla é mais
 *   curto que isso; a fala, não). O áudio sai atrasado `lookaheadMs`, então o começo da
 *   palavra que abriu o portão não é cortado.
 * - Fica aberto `holdMs` depois da última sílaba, para não picotar entre palavras.
 * - No modo automático o limiar acompanha o ruído de fundo: cai rápido quando o ambiente
 *   fica silencioso e sobe devagar (sobe ainda mais devagar enquanto a pessoa fala).
 */
export interface GateConfig {
  /** false = tudo passa (ex.: push-to-talk ligado ou opção desmarcada). */
  enabled: boolean;
  auto: boolean;
  /** Limiar manual em dBFS. */
  thresholdDb: number;
}

/**
 * Valores calibrados com gravações reais de teclado mecânico (ESC-50) e voz (LibriSpeech)
 * passando pela IA: com mínimo de -50 dB e 12 ms de confirmação, o portão fica fechado em
 * ~90% do tempo só de digitação e mantém ~98% da fala (antes: -60 dB e 8 ms, aberto em 53%).
 */
export const GATE = {
  holdMs: 320,
  confirmMs: 12,
  /** Atraso do áudio para o começo da palavra que abriu o portão não sumir (> confirmação + 1 bloco). */
  lookaheadMs: 16,
  attackMs: 3,
  releaseMs: 60,
  /** Automático: limiar = ruído de fundo + margem, dentro da faixa abaixo. */
  autoMarginDb: 15,
  autoMinDb: -50,
  autoMaxDb: -40,
  floorStartDb: -60,
  /** Constantes de tempo do ruído de fundo (ms). */
  floorFallMs: 150,
  floorRiseMs: 4_000,
  floorRiseWhileOpenMs: 20_000,
  /** Abaixo disso é silêncio digital (microfone mudo): não ensina nada sobre o ambiente. */
  silenceDb: -95,
} as const;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export class GateEngine {
  private config: GateConfig;
  private isOpen = false;
  private aboveMs = 0;
  private holdLeftMs = 0;
  /** Ruído de fundo estimado (dBFS). */
  floorDb: number = GATE.floorStartDb;
  /** Volume suavizado, para o medidor das configurações (dBFS). */
  levelDb = -100;

  constructor(config: GateConfig) {
    this.config = { ...config };
  }

  configure(config: GateConfig): void {
    this.config = { ...config };
    if (!config.enabled) this.isOpen = true;
  }

  get open(): boolean {
    return this.isOpen;
  }

  get thresholdDb(): number {
    return this.config.auto
      ? clamp(this.floorDb + GATE.autoMarginDb, GATE.autoMinDb, GATE.autoMaxDb)
      : this.config.thresholdDb;
  }

  /** Volume (dBFS) de um bloco com `blockMs` de duração; devolve se o som deve passar. */
  step(db: number, blockMs: number): boolean {
    // medidor: sobe na hora, desce em ~120 ms
    this.levelDb = db > this.levelDb ? db : this.levelDb + (db - this.levelDb) * Math.min(1, blockMs / 120);

    if (!this.config.enabled) {
      this.isOpen = true;
      return true;
    }
    this.trackFloor(db, blockMs);

    if (db >= this.thresholdDb) {
      this.aboveMs += blockMs;
      if (this.isOpen || this.aboveMs >= GATE.confirmMs) {
        this.isOpen = true;
        this.holdLeftMs = GATE.holdMs;
      }
    } else {
      this.aboveMs = 0;
      if (this.isOpen) {
        this.holdLeftMs -= blockMs;
        if (this.holdLeftMs <= 0) this.isOpen = false;
      }
    }
    return this.isOpen;
  }

  private trackFloor(db: number, blockMs: number) {
    if (db < GATE.silenceDb) return;
    const tau = db < this.floorDb ? GATE.floorFallMs : this.isOpen ? GATE.floorRiseWhileOpenMs : GATE.floorRiseMs;
    this.floorDb += (db - this.floorDb) * Math.min(1, blockMs / tau);
  }
}

/** Volume RMS de um bloco de amostras, em dBFS (-120 para silêncio absoluto). */
export function blockDb(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return rms > 1e-6 ? 20 * Math.log10(rms) : -120;
}
