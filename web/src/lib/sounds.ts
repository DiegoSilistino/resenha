/**
 * Sons do app, sintetizados com Web Audio (sem arquivos para baixar).
 * Curtos e suaves, no estilo dos avisos do Discord: entrar/sair sobe/desce, mutar é um "tic".
 */
import { useSettings } from "../state/settings.ts";

export type SoundName = "join" | "leave" | "mute" | "unmute" | "deafen" | "undeafen" | "message";

export interface Tone {
  /** Início, em segundos a partir do disparo. */
  at: number;
  dur: number;
  /** Frequência inicial (Hz); com `to`, desliza até ela. */
  from: number;
  to?: number;
  type?: OscillatorType;
  /** Volume relativo da nota (1 = normal). */
  gain?: number;
}

const E5 = 659.25;
const B5 = 987.77;
const E6 = 1318.51;

export const SOUNDS: Record<SoundName, Tone[]> = {
  join: [
    { at: 0, dur: 0.12, from: E5 },
    { at: 0.09, dur: 0.2, from: B5 },
  ],
  leave: [
    { at: 0, dur: 0.12, from: B5 },
    { at: 0.09, dur: 0.22, from: E5 },
  ],
  mute: [{ at: 0, dur: 0.1, from: 620, to: 430, type: "triangle", gain: 1.2 }],
  unmute: [{ at: 0, dur: 0.1, from: 430, to: 620, type: "triangle", gain: 1.2 }],
  deafen: [
    { at: 0, dur: 0.08, from: 560, to: 420, type: "triangle", gain: 1.2 },
    { at: 0.08, dur: 0.12, from: 420, to: 300, type: "triangle", gain: 1.2 },
  ],
  undeafen: [
    { at: 0, dur: 0.08, from: 300, to: 420, type: "triangle", gain: 1.2 },
    { at: 0.08, dur: 0.12, from: 420, to: 560, type: "triangle", gain: 1.2 },
  ],
  // "plim" de mensagem: nota aguda com um harmônico leve, como um sininho
  message: [
    { at: 0, dur: 0.28, from: E6, gain: 0.8 },
    { at: 0, dur: 0.2, from: E6 * 2, gain: 0.12 },
  ],
};

const CALL_SOUNDS = new Set<SoundName>(["join", "leave", "mute", "unmute", "deafen", "undeafen"]);
/** Intervalo mínimo entre repetições do mesmo som (evita metralhadora de "plim"). */
const MIN_GAP_MS: Partial<Record<SoundName, number>> = { message: 1_500 };
const DEFAULT_GAP_MS = 120;

let ctx: AudioContext | null = null;
let appliedSink: string | null = null;
const lastPlayed = new Map<SoundName, number>();

function context(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  ctx ??= new AudioContext({ latencyHint: "interactive" });
  applySink();
  return ctx;
}

/** Os sons saem no mesmo fone/caixa escolhido para a chamada. */
function applySink() {
  const id = useSettings.getState().speakerDeviceId ?? "";
  if (!ctx || appliedSink === id) return;
  const withSink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (!withSink.setSinkId) return;
  appliedSink = id;
  void withSink.setSinkId(id).catch(() => {
    appliedSink = null;
  });
}

export function soundDuration(name: SoundName): number {
  return Math.max(...SOUNDS[name].map((t) => t.at + t.dur));
}

/** Toca o som se a preferência permitir. Nunca lança erro: som é enfeite. */
export function playSound(name: SoundName): void {
  const s = useSettings.getState();
  if (CALL_SOUNDS.has(name) ? !s.callSounds : !s.notifySound) return;
  if (s.soundVolume <= 0) return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < (MIN_GAP_MS[name] ?? DEFAULT_GAP_MS)) return;
  lastPlayed.set(name, now);

  try {
    const ac = context();
    if (!ac) return;
    if (ac.state === "suspended") void ac.resume().catch(() => undefined);
    const master = ac.createGain();
    // curva de volume perceptual: 50% no controle soa como metade
    master.gain.value = 0.35 * s.soundVolume ** 2;
    master.connect(ac.destination);
    const t0 = ac.currentTime + 0.01;
    for (const tone of SOUNDS[name]) {
      const osc = ac.createOscillator();
      const env = ac.createGain();
      osc.type = tone.type ?? "sine";
      osc.frequency.setValueAtTime(tone.from, t0 + tone.at);
      if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to, t0 + tone.at + tone.dur);
      const peak = tone.gain ?? 1;
      env.gain.setValueAtTime(0.0001, t0 + tone.at);
      env.gain.linearRampToValueAtTime(peak, t0 + tone.at + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.at + tone.dur);
      osc.connect(env).connect(master);
      osc.start(t0 + tone.at);
      osc.stop(t0 + tone.at + tone.dur + 0.02);
    }
    setTimeout(() => master.disconnect(), (soundDuration(name) + 0.1) * 1000);
  } catch {
    // navegador sem Web Audio ou contexto bloqueado: segue sem som
  }
}

useSettings.subscribe((s, prev) => {
  if (s.speakerDeviceId !== prev.speakerDeviceId) applySink();
});
