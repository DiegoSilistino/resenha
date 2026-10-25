/**
 * Cadeia do microfone: supressão de ruído com IA (GTCRN) -> portão de sensibilidade.
 *
 * Roda num AudioContext próprio a 48 kHz: a GTCRN só aceita 16 ou 48 kHz, e o contexto
 * da sala segue a placa de som (muitos fones no Windows vêm em 44,1 kHz).
 */
import type { AudioProcessorOptions, Track, TrackProcessor } from "livekit-client";
import { GtcrnWorkletNode } from "@sapphi-red/web-noise-suppressor";
import gtcrnWorkletUrl from "@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url";
import gtcrnWasmUrl from "@sapphi-red/web-noise-suppressor/gtcrn.wasm?url";
import gateWorkletUrl from "./worklet.ts?worker&url";
import type { GateConfig } from "./engine.ts";

export interface MicChainConfig {
  /** Supressão de ruído com IA (tira teclado e barulho até durante a fala). */
  ai: boolean;
  gate: GateConfig;
}

export interface MicLevel {
  /** Volume atual (dBFS), já depois da IA. */
  level: number;
  /** Limiar em uso (dBFS); no automático, muda com o ambiente. */
  threshold: number;
  /** true = o som está passando (você está "transmitindo"). */
  open: boolean;
  /** performance.now() da leitura. */
  at: number;
}

const SAMPLE_RATE = 48_000;

/** Última leitura, de quem estiver medindo (a chamada ou o teste das configurações). */
let latest: MicLevel | null = null;
export const currentMicLevel = (): MicLevel | null => (latest && performance.now() - latest.at < 500 ? latest : null);

/** O modelo (~200 KB) é baixado uma vez e fica em cache (o arquivo tem hash no nome). */
let wasm: Promise<ArrayBuffer> | null = null;
function gtcrnWasm(): Promise<ArrayBuffer> {
  if (!wasm) {
    wasm = fetch(gtcrnWasmUrl).then((r) => {
      if (!r.ok) throw new Error(`modelo de IA indisponível (${r.status})`);
      return r.arrayBuffer();
    });
    wasm.catch(() => {
      wasm = null; // tenta de novo na próxima vez
    });
  }
  return wasm;
}

/** Contexto parado (o navegador exige um clique): volta a tocar no próximo clique. */
function resumeOnGesture(ctx: AudioContext) {
  if (ctx.state !== "suspended") return;
  void ctx.resume().catch(() => undefined);
  const resume = () => {
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    document.removeEventListener("pointerdown", resume, true);
  };
  document.addEventListener("pointerdown", resume, true);
}

class MicChain {
  private constructor(
    private readonly ctx: AudioContext,
    private readonly nodes: AudioNode[],
    private readonly gate: AudioWorkletNode,
    private readonly ai: GtcrnWorkletNode | null,
    private readonly monitorGain: GainNode,
    readonly output: MediaStreamTrack,
    /** false se a IA foi pedida mas não carregou (a cadeia segue sem ela). */
    readonly aiActive: boolean,
  ) {}

  static async create(track: MediaStreamTrack, config: MicChainConfig): Promise<MicChain> {
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
    try {
      resumeOnGesture(ctx);
      await ctx.audioWorklet.addModule(gateWorkletUrl);
      const source = ctx.createMediaStreamSource(new MediaStream([track]));

      let ai: GtcrnWorkletNode | null = null;
      if (config.ai) {
        try {
          const [binary] = await Promise.all([gtcrnWasm(), ctx.audioWorklet.addModule(gtcrnWorkletUrl)]);
          ai = new GtcrnWorkletNode(ctx, { maxChannels: 1, wasmBinary: binary });
          ai.channelCount = 1;
          ai.channelCountMode = "explicit";
        } catch (err) {
          console.warn("[voz] supressão de ruído com IA indisponível", err);
        }
      }

      const gate = new AudioWorkletNode(ctx, "resenha-gate", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        // fone estéreo vira mono antes de tudo (voz não precisa de dois canais)
        channelCount: 1,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      });
      gate.port.onmessage = (e: MessageEvent<Omit<MicLevel, "at">>) => {
        latest = { ...e.data, at: performance.now() };
      };
      gate.port.postMessage({ type: "config", ...config.gate });

      const destination = ctx.createMediaStreamDestination();
      destination.channelCount = 1;
      // Saída para os alto-falantes só no teste "ouvir meu microfone"; ganho 0 no resto.
      // (Também garante que o grafo seja processado mesmo sem ninguém ouvindo.)
      const monitorGain = ctx.createGain();
      monitorGain.gain.value = 0;

      if (ai) source.connect(ai).connect(gate);
      else source.connect(gate);
      gate.connect(destination);
      gate.connect(monitorGain).connect(ctx.destination);

      const output = destination.stream.getAudioTracks()[0]!;
      const nodes = [source, ...(ai ? [ai] : []), gate, destination, monitorGain];
      return new MicChain(ctx, nodes, gate, ai, monitorGain, output, !config.ai || !!ai);
    } catch (err) {
      void ctx.close();
      throw err;
    }
  }

  reconfigureGate(gate: GateConfig): void {
    this.gate.port.postMessage({ type: "config", ...gate });
  }

  setMonitor(on: boolean): void {
    this.monitorGain.gain.value = on ? 1 : 0;
  }

  close(): void {
    for (const n of this.nodes) n.disconnect();
    this.ai?.destroy(); // libera a memória do modelo dentro do worklet
    this.gate.port.close();
    this.output.stop();
    void this.ctx.close();
    latest = null;
  }
}

/** Processador de áudio do LiveKit: o que vai para a chamada é a saída da cadeia. */
export class MicProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = "resenha-mic";
  processedTrack?: MediaStreamTrack;
  private chain: MicChain | null = null;

  constructor(
    private readonly config: () => MicChainConfig,
    private readonly onAiUnavailable?: () => void,
  ) {}

  async init({ track }: AudioProcessorOptions): Promise<void> {
    await this.build(track);
  }

  async restart({ track }: AudioProcessorOptions): Promise<void> {
    this.teardown();
    await this.build(track);
  }

  async destroy(): Promise<void> {
    this.teardown();
  }

  /** Sensibilidade, automático ou push-to-talk mudaram: aplica sem recriar nada. */
  reconfigure(): void {
    this.chain?.reconfigureGate(this.config().gate);
  }

  private async build(track: MediaStreamTrack): Promise<void> {
    this.chain = await MicChain.create(track, this.config());
    if (!this.chain.aiActive) this.onAiUnavailable?.();
    this.processedTrack = this.chain.output;
  }

  private teardown(): void {
    this.chain?.close();
    this.chain = null;
    this.processedTrack = undefined;
  }
}

/**
 * Teste do microfone fora da chamada (aba Áudio): a mesma cadeia da chamada. Com `monitor`,
 * a pessoa se ouve exatamente como os amigos vão ouvir. Devolve os controles do teste.
 */
export async function startMicTest(
  constraints: MediaTrackConstraints,
  config: MicChainConfig,
): Promise<{ stop(): void; reconfigure(gate: GateConfig): void; setMonitor(on: boolean): void; aiActive: boolean }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
  try {
    const chain = await MicChain.create(stream.getAudioTracks()[0]!, config);
    return {
      aiActive: chain.aiActive,
      stop() {
        chain.close();
        stream.getTracks().forEach((t) => t.stop());
      },
      reconfigure: (gate) => chain.reconfigureGate(gate),
      setMonitor: (on) => chain.setMonitor(on),
    };
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    throw err;
  }
}
