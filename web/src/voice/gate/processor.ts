/**
 * Liga o portão (worklet) ao microfone do LiveKit e ao medidor das configurações.
 */
import type { AudioProcessorOptions, Track, TrackProcessor } from "livekit-client";
import workletUrl from "./worklet.ts?worker&url";
import type { GateConfig } from "./engine.ts";

export interface MicLevel {
  /** Volume atual (dBFS). */
  level: number;
  /** Limiar em uso (dBFS); no automático, muda com o ambiente. */
  threshold: number;
  /** true = o som está passando (você está "transmitindo"). */
  open: boolean;
  /** performance.now() da leitura. */
  at: number;
}

/** Última leitura, de quem estiver medindo (a chamada ou o teste das configurações). */
let latest: MicLevel | null = null;
export const currentMicLevel = (): MicLevel | null => (latest && performance.now() - latest.at < 500 ? latest : null);

const modules = new WeakMap<BaseAudioContext, Promise<void>>();
function loadWorklet(ctx: BaseAudioContext): Promise<void> {
  let p = modules.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(workletUrl);
    modules.set(ctx, p);
    p.catch(() => modules.delete(ctx));
  }
  return p;
}

function createGateNode(ctx: AudioContext, config: GateConfig): AudioWorkletNode {
  const node = new AudioWorkletNode(ctx, "resenha-gate", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    // fone estéreo vira mono antes do portão (voz não precisa de dois canais)
    channelCount: 1,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
  });
  node.port.onmessage = (e: MessageEvent<Omit<MicLevel, "at">>) => {
    latest = { ...e.data, at: performance.now() };
  };
  node.port.postMessage({ type: "config", ...config });
  return node;
}

/** Processador de áudio do LiveKit: microfone -> portão -> o que é enviado para a chamada. */
export class GateProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = "resenha-gate";
  processedTrack?: MediaStreamTrack;
  private nodes: AudioNode[] = [];
  private gate: AudioWorkletNode | null = null;

  constructor(private readonly config: () => GateConfig) {}

  async init(opts: AudioProcessorOptions): Promise<void> {
    await this.build(opts);
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    this.teardown();
    await this.build(opts);
  }

  async destroy(): Promise<void> {
    this.teardown();
  }

  /** Aplica a preferência nova (sensibilidade, automático, push-to-talk) sem recriar nada. */
  reconfigure(): void {
    this.gate?.port.postMessage({ type: "config", ...this.config() });
  }

  private async build({ track, audioContext }: AudioProcessorOptions): Promise<void> {
    await loadWorklet(audioContext);
    const source = audioContext.createMediaStreamSource(new MediaStream([track]));
    const gate = createGateNode(audioContext, this.config());
    const destination = audioContext.createMediaStreamDestination();
    destination.channelCount = 1;
    source.connect(gate).connect(destination);
    this.nodes = [source, gate, destination];
    this.gate = gate;
    this.processedTrack = destination.stream.getAudioTracks()[0];
  }

  private teardown(): void {
    for (const n of this.nodes) n.disconnect();
    this.nodes = [];
    this.gate?.port.close();
    this.gate = null;
    this.processedTrack?.stop();
    this.processedTrack = undefined;
    latest = null;
  }
}

/**
 * Teste do microfone fora da chamada (aba Áudio das configurações): mesmo portão,
 * mesmas opções, mas o som não vai para lugar nenhum. Devolve a função que encerra.
 */
export async function startMicTest(constraints: MediaTrackConstraints, config: GateConfig): Promise<{
  stop(): void;
  reconfigure(config: GateConfig): void;
}> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
  const ctx = new AudioContext({ latencyHint: "interactive" });
  try {
    await loadWorklet(ctx);
    const source = ctx.createMediaStreamSource(stream);
    const gate = createGateNode(ctx, config);
    // O nó precisa chegar a uma saída para ser processado; ganho 0 = silêncio.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(gate).connect(mute).connect(ctx.destination);
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    return {
      stop() {
        stream.getTracks().forEach((t) => t.stop());
        gate.port.close();
        void ctx.close();
        latest = null;
      },
      reconfigure(next) {
        gate.port.postMessage({ type: "config", ...next });
      },
    };
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    throw err;
  }
}
