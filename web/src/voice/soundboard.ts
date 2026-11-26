/**
 * Mesa de sons: toca para todo mundo da chamada um som curto que alguém escolheu.
 * O servidor só repassa "fulano tocou o som X"; cada navegador baixa (uma vez), decodifica
 * e toca no próprio volume da mesa, respeitando quem está ensurdecido ou desligou os sons.
 */
import { LIMITS, type ServerEvent, type SoundboardSound } from "@resenha/shared";
import { realtime } from "../lib/realtime.ts";
import { useApp } from "../state/app.ts";
import { useSettings } from "../state/settings.ts";
import { useVoice } from "./state.ts";

type PlayedEvent = Extract<ServerEvent, { type: "soundboard.played" }>;

/** Nenhum som passa disso, mesmo que o arquivo seja maior (o limite é 5 s). */
const HARD_STOP_S = LIMITS.soundMaxSeconds + 1;
/** Sons ao mesmo tempo; o mais antigo para quando chega mais um. */
const MAX_AT_ONCE = 4;
/** Quanto tempo a figurinha "tocou um som" fica no quadradinho da pessoa. */
export const PLAY_MARK_MS = 3_000;
/** Sons decodificados guardados (~1 MB cada); os usados há mais tempo saem primeiro. */
const CACHE_MAX = 24;

let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();
const playing: AudioBufferSourceNode[] = [];

function audio(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: "interactive" });
    void applySpeaker();
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

/** Mesma saída de áudio escolhida nas configurações (fone ou caixa). */
async function applySpeaker(): Promise<void> {
  const id = useSettings.getState().speakerDeviceId;
  const c = ctx as (AudioContext & { setSinkId?(id: string): Promise<void> }) | null;
  if (!c?.setSinkId) return;
  try {
    await c.setSinkId(id ?? "");
  } catch {
    // saída sumiu (fone desconectado): fica na padrão
  }
}

function load(sound: SoundboardSound): Promise<AudioBuffer> {
  let p = buffers.get(sound.id);
  if (p) {
    buffers.delete(sound.id); // volta para o fim da fila (usado agora)
    buffers.set(sound.id, p);
  } else {
    p = fetch(sound.url)
      .then((r) => {
        if (!r.ok) throw new Error(`som indisponível (${r.status})`);
        return r.arrayBuffer();
      })
      .then((data) => audio().decodeAudioData(data));
    p.catch(() => buffers.delete(sound.id));
    buffers.set(sound.id, p);
    if (buffers.size > CACHE_MAX) buffers.delete(buffers.keys().next().value!);
  }
  return p;
}

export function stopAllSounds(): void {
  for (const node of playing.splice(0)) {
    try {
      node.stop();
    } catch {
      // já tinha parado
    }
  }
}

/** Toca um som no seu navegador (também usado na prévia do envio). */
export function playBuffer(buffer: AudioBuffer, volume = useSettings.getState().soundboardVolume): AudioBufferSourceNode {
  const c = audio();
  const node = c.createBufferSource();
  node.buffer = buffer;
  const gain = c.createGain();
  gain.gain.value = volume;
  node.connect(gain).connect(c.destination);
  node.onended = () => {
    const i = playing.indexOf(node);
    if (i !== -1) playing.splice(i, 1);
    gain.disconnect();
  };
  if (playing.length >= MAX_AT_ONCE) {
    try {
      playing.shift()?.stop();
    } catch {
      // já tinha parado
    }
  }
  playing.push(node);
  node.start();
  node.stop(c.currentTime + HARD_STOP_S);
  return node;
}

/** Contexto de áudio da mesa (para decodificar a prévia no mesmo lugar onde toca). */
export const soundboardAudio = (): AudioContext => audio();

/** Chegou "fulano tocou X" do servidor. */
export async function onSoundboardPlayed(e: PlayedEvent): Promise<void> {
  const v = useVoice.getState();
  if (v.status === "idle" || v.channelId !== e.channelId) return;
  // o som vem no evento: o da mesa pessoal de alguém não está na sua lista
  const sound = e.sound ?? useApp.getState().sounds.find((s) => s.id === e.soundId);
  if (!sound) return;
  useVoice.setState((s) => ({ soundPlays: { ...s.soundPlays, [e.userId]: { sound, at: Date.now() } } }));

  const settings = useSettings.getState();
  if (!settings.soundboardEnabled || v.deafened) return;
  try {
    const buffer = await load(sound);
    // pode ter ensurdecido ou saído enquanto o som baixava
    const now = useVoice.getState();
    if (now.deafened || now.channelId !== e.channelId) return;
    playBuffer(buffer);
  } catch (err) {
    console.warn("[mesa de sons] não deu para tocar", sound.name, err);
  }
}

let lastSentAt = 0;
/** Pede para tocar um som para a chamada. Devolve false se ainda está no intervalo entre sons. */
export function requestSound(soundId: string): boolean {
  const v = useVoice.getState();
  if (!v.channelId || v.status === "idle") return false;
  const now = Date.now();
  if (now - lastSentAt < LIMITS.soundboardCooldownMs) return false;
  lastSentAt = now;
  audio(); // destrava o áudio com este clique (o som chega em seguida pelo servidor)
  return realtime.send({ type: "soundboard.play", channelId: v.channelId, soundId });
}

/** Quando faltam para poder tocar de novo (ms). */
export const cooldownLeft = (): number => Math.max(0, LIMITS.soundboardCooldownMs - (Date.now() - lastSentAt));

realtime.onEvent((e) => {
  if (e.type === "soundboard.played") void onSoundboardPlayed(e);
});

// Ensurdeceu ou saiu da chamada: corta o que estiver tocando.
useVoice.subscribe((s, prev) => {
  if ((s.deafened && !prev.deafened) || (s.status === "idle" && prev.status !== "idle")) stopAllSounds();
  if (s.status === "idle" && prev.status !== "idle" && Object.keys(s.soundPlays).length) useVoice.setState({ soundPlays: {} });
});
useSettings.subscribe((s, prev) => {
  if (s.speakerDeviceId !== prev.speakerDeviceId) void applySpeaker();
  if (!s.soundboardEnabled && prev.soundboardEnabled) stopAllSounds();
});
// Som apagado: esquece o arquivo.
useApp.subscribe((s, prev) => {
  if (s.sounds === prev.sounds) return;
  const ids = new Set(s.sounds.map((x) => x.id));
  for (const id of buffers.keys()) if (!ids.has(id)) buffers.delete(id);
});
