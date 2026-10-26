/**
 * Preparo de um som para a mesa de sons, todo no navegador de quem envia:
 * escolhe um trecho de até 5 s, mistura em mono, iguala o volume e grava em WAV.
 * Assim todo som chega aos amigos no mesmo formato (qualquer navegador toca) e
 * ninguém leva um susto com um áudio estourado.
 */
import { LIMITS } from "@resenha/shared";

export const CLIP_SAMPLE_RATE = 44_100;
/** Volume de referência da parte "ativa" do som (~ -18 dBFS), um pouco abaixo de uma voz na chamada. */
const TARGET_RMS = 0.126;
/** Teto para não estourar. */
const PEAK_CEILING = 0.97;
/** No máximo +18 dB: som baixinho demais não vira chiado alto. */
const MAX_GAIN = 8;
/** Janelas abaixo disso (~ -45 dBFS) são silêncio e não entram na conta do volume. */
const SILENCE_RMS = 0.0056;
/** Arquivo aceito para escolher o trecho (o som final é bem menor). */
export const SOURCE_MAX_BYTES = 8 * 1024 * 1024;

/** Ganho para deixar a parte com som perto do volume de referência, sem passar do teto. */
export function loudnessGain(samples: Float32Array, sampleRate: number): number {
  const win = Math.max(1, Math.round(sampleRate * 0.02));
  let peak = 0;
  let activePower = 0;
  let activeWindows = 0;
  for (let i = 0; i < samples.length; i += win) {
    let power = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) {
      const v = samples[j]!;
      power += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    power /= end - i;
    if (Math.sqrt(power) >= SILENCE_RMS) {
      activePower += power;
      activeWindows++;
    }
  }
  if (!activeWindows || peak === 0) return 1;
  const rms = Math.sqrt(activePower / activeWindows);
  return Math.min(TARGET_RMS / rms, PEAK_CEILING / peak, MAX_GAIN);
}

/** Onde o som começa de verdade (pula silêncio inicial), em segundos, com uma folguinha. */
export function firstSoundAt(samples: Float32Array, sampleRate: number): number {
  const threshold = 0.01; // ~ -40 dBFS
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]!) >= threshold) return Math.max(0, i / sampleRate - 0.05);
  }
  return 0;
}

/** WAV PCM 16 bits mono. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytes = 44 + samples.length * 2;
  const buf = new ArrayBuffer(bytes);
  const v = new DataView(buf);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, bytes - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true); // tamanho do bloco fmt
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // bytes por segundo
  v.setUint16(32, 2, true); // bytes por amostra
  v.setUint16(34, 16, true); // bits
  text(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

/** Picos por coluna para desenhar a onda (0 a 1). */
export function waveformPeaks(samples: Float32Array, columns: number): number[] {
  const out: number[] = [];
  const step = samples.length / columns;
  for (let c = 0; c < columns; c++) {
    let peak = 0;
    const end = Math.min(samples.length, Math.floor((c + 1) * step));
    for (let i = Math.floor(c * step); i < end; i++) {
      const a = Math.abs(samples[i]!);
      if (a > peak) peak = a;
    }
    out.push(peak);
  }
  const max = Math.max(...out, 0.0001);
  return out.map((p) => p / max);
}

// ---------------------------------------------------------------- partes que usam o navegador

/** Lê o áudio do arquivo escolhido (MP3, WAV, OGG, M4A, e o som de vídeos MP4/WebM). */
export async function decodeSource(file: File): Promise<AudioBuffer> {
  if (file.size > SOURCE_MAX_BYTES) throw new Error("O arquivo passa de 8 MB. Escolha um áudio menor.");
  const data = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, CLIP_SAMPLE_RATE);
  try {
    return await ctx.decodeAudioData(data);
  } catch {
    throw new Error("Não consegui ler o áudio desse arquivo. Tente MP3, WAV, OGG ou M4A.");
  }
}

/** Mistura em mono, a 44,1 kHz, só o trecho escolhido. */
export async function renderClip(source: AudioBuffer, start: number, duration: number): Promise<Float32Array<ArrayBuffer>> {
  const length = Math.max(1, Math.round(duration * CLIP_SAMPLE_RATE));
  const ctx = new OfflineAudioContext(1, length, CLIP_SAMPLE_RATE);
  const node = ctx.createBufferSource();
  node.buffer = source;
  node.connect(ctx.destination);
  node.start(0, start, duration);
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

/** Versão mono do arquivo inteiro (para a onda e para achar onde o som começa). */
export async function monoOverview(source: AudioBuffer): Promise<Float32Array> {
  // Taxa baixa: basta para desenhar a onda e é rápido mesmo com áudio longo.
  const rate = 8_000;
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(source.duration * rate)), rate);
  const node = ctx.createBufferSource();
  node.buffer = source;
  node.connect(ctx.destination);
  node.start();
  return (await ctx.startRendering()).getChannelData(0);
}

/** Trecho pronto: volume igualado e gravado em WAV. */
export async function buildClip(
  source: AudioBuffer,
  start: number,
): Promise<{ blob: Blob; samples: Float32Array<ArrayBuffer> }> {
  const duration = Math.min(LIMITS.soundMaxSeconds, source.duration - start);
  const samples = await renderClip(source, start, duration);
  const gain = loudnessGain(samples, CLIP_SAMPLE_RATE);
  for (let i = 0; i < samples.length; i++) samples[i]! *= gain;
  // fade de 10 ms nas pontas: corte no meio da onda vira "clique"
  const fade = Math.min(Math.round(CLIP_SAMPLE_RATE * 0.01), Math.floor(samples.length / 2));
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    samples[i]! *= k;
    samples[samples.length - 1 - i]! *= k;
  }
  return { blob: encodeWav(samples, CLIP_SAMPLE_RATE), samples };
}
