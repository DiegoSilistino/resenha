/**
 * AudioWorklet do portão do microfone: roda na thread de áudio do navegador, então não
 * sofre com a lentidão de timers em abas de segundo plano (o que cortaria o início da fala).
 * Vite empacota este arquivo à parte (import "...?worker&url").
 */
import { blockDb, GATE, GateEngine, type GateConfig } from "./engine.ts";

// Globais do AudioWorkletGlobalScope (o TypeScript não tem esses tipos na lib DOM).
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: unknown): void;

const REPORT_EVERY_MS = 50;

class GateProcessor extends AudioWorkletProcessor {
  private readonly engine = new GateEngine({ enabled: true, auto: true, thresholdDb: -50 });
  private readonly delay = new Float32Array(Math.max(1, Math.round((GATE.lookaheadMs * sampleRate) / 1000)));
  private writeAt = 0;
  private gain = 0;
  private readonly attack = 1 - Math.exp(-1 / ((GATE.attackMs * sampleRate) / 1000));
  private readonly release = 1 - Math.exp(-1 / ((GATE.releaseMs * sampleRate) / 1000));
  private sinceReportMs = 0;
  private enabled = true;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<{ type: "config" } & GateConfig>) => {
      if (e.data?.type !== "config") return;
      this.enabled = e.data.enabled;
      this.engine.configure(e.data);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]?.[0];
    if (!output) return true;
    const input = inputs[0]?.[0];
    if (!input) {
      output.fill(0);
      return true;
    }
    const blockMs = (input.length / sampleRate) * 1000;
    const open = this.engine.step(blockDb(input), blockMs);

    if (!this.enabled) {
      output.set(input); // sem portão, sem atraso
      this.gain = 1;
    } else {
      const target = open ? 1 : 0;
      const coef = open ? this.attack : this.release;
      const delay = this.delay;
      for (let i = 0; i < input.length; i++) {
        const delayed = delay[this.writeAt]!;
        delay[this.writeAt] = input[i]!;
        this.writeAt = this.writeAt + 1 === delay.length ? 0 : this.writeAt + 1;
        this.gain += (target - this.gain) * coef;
        output[i] = delayed * this.gain;
      }
    }

    this.sinceReportMs += blockMs;
    if (this.sinceReportMs >= REPORT_EVERY_MS) {
      this.sinceReportMs = 0;
      this.port.postMessage({ level: this.engine.levelDb, threshold: this.engine.thresholdDb, open: this.engine.open });
    }
    return true;
  }
}

registerProcessor("resenha-gate", GateProcessor);
