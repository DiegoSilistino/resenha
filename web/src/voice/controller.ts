/**
 * Controle da chamada de voz (LiveKit). Fica fora do React: a conexão sobrevive
 * à troca de páginas, igual ao Discord (você navega pelo chat e continua na voz).
 */
import {
  ConnectionState,
  DisconnectReason,
  type LocalAudioTrack,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  Room,
  RoomEvent,
  ScreenSharePresets,
  Track,
  VideoPresets,
} from "livekit-client";
import { create } from "zustand";
import { CAPTIONS_TOPIC } from "@resenha/shared";
import { api, ApiError } from "../lib/api.ts";
import { realtime } from "../lib/realtime.ts";
import { useSettings } from "../state/settings.ts";
import { toast } from "../state/toasts.ts";
import { SpeechCaptioner, type CaptionChunk } from "./speech.ts";

export type VoiceStatus = "idle" | "connecting" | "connected" | "reconnecting";

export interface Caption {
  text: string;
  final: boolean;
  at: number;
}

interface VoiceState {
  status: VoiceStatus;
  channelId: string | null;
  /** Preferências de mute/ensurdecer valem mesmo fora de uma chamada. */
  muted: boolean;
  deafened: boolean;
  screenSharing: boolean;
  cameraOn: boolean;
  pttActive: boolean;
  /** O navegador bloqueou o áudio até a pessoa clicar em algo. */
  audioBlocked: boolean;
  /** Incrementa a cada mudança na sala, para o React redesenhar. */
  version: number;
  speaking: Record<string, true>;
  captions: Record<string, Caption>;
}

export const useVoice = create<VoiceState>()(() => ({
  status: "idle",
  channelId: null,
  muted: false,
  deafened: false,
  screenSharing: false,
  cameraOn: false,
  pttActive: false,
  audioBlocked: false,
  version: 0,
  speaking: {},
  captions: {},
}));

const setV = useVoice.setState;
const bump = () => setV((s) => ({ version: s.version + 1 }));

let room: Room | null = null;
let joinSeq = 0;
/** Salas que chegaram a conectar (antes disso, falhas são tratadas pelo joinVoice). */
const established = new WeakSet<Room>();

export const currentRoom = () => room;

/** Participantes da sala atual (você primeiro). Use junto com `useVoice(s => s.version)`. */
export function roomParticipants(): Participant[] {
  if (!room) return [];
  return [room.localParticipant, ...room.remoteParticipants.values()];
}

// ---------------------------------------------------------------- entrar/sair

export async function joinVoice(channelId: string): Promise<void> {
  const st = useVoice.getState();
  if (st.channelId === channelId && st.status !== "idle") return;
  if (room) await leaveVoice();

  const seq = ++joinSeq;
  setV({ status: "connecting", channelId, screenSharing: false, cameraOn: false, speaking: {}, captions: {} });
  let r: Room | null = null;
  try {
    const { url, token } = await api.voiceToken(channelId);
    if (seq !== joinSeq) return;

    const s = useSettings.getState();
    r = new Room({
      adaptiveStream: true,
      dynacast: true,
      // Mixagem via Web Audio: permite volume individual acima de 100%.
      webAudioMix: true,
      audioCaptureDefaults: micOptions(),
      audioOutput: s.speakerDeviceId ? { deviceId: s.speakerDeviceId } : undefined,
      publishDefaults: {
        dtx: true,
        red: true,
        screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
      },
    });
    room = r;
    wire(r);
    await r.connect(url, token);
    if (seq !== joinSeq) {
      await r.disconnect();
      return;
    }

    established.add(r);
    setV({ status: "connected", audioBlocked: !r.canPlaybackAudio });
    realtime.send({ type: "voice.join", channelId });
    applyVolumes();
    await applyMic();
    syncFlags();
    bump();
  } catch (err) {
    if (seq !== joinSeq) return;
    if (r) await r.disconnect().catch(() => undefined);
    if (room === r) room = null;
    resetCallState();
    toast.error(
      err instanceof ApiError
        ? err.message
        : "Não foi possível conectar à voz. Verifique se o servidor de voz (LiveKit) está no ar.",
    );
  }
}

export async function leaveVoice(): Promise<void> {
  joinSeq++;
  const r = room;
  room = null;
  captioner.setActive(false, useSettings.getState().captionsLang);
  if (r) await r.disconnect().catch(() => undefined);
  clearAudioSink();
  resetCallState();
  realtime.send({ type: "voice.leave" });
}

function resetCallState() {
  setV((s) => ({
    status: "idle",
    channelId: null,
    screenSharing: false,
    cameraOn: false,
    pttActive: false,
    audioBlocked: false,
    speaking: {},
    captions: {},
    version: s.version + 1,
  }));
}

// ---------------------------------------------------------------- eventos da sala

function wire(r: Room) {
  r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Audio) attachAudio(track);
    applyVolumes();
    bump();
  })
    .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      for (const el of track.detach()) el.remove();
      bump();
    })
    .on(RoomEvent.ParticipantConnected, bump)
    .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      setV((s) => {
        const captions = { ...s.captions };
        delete captions[p.identity];
        return { captions, version: s.version + 1 };
      });
    })
    .on(RoomEvent.TrackMuted, bump)
    .on(RoomEvent.TrackUnmuted, bump)
    .on(RoomEvent.TrackPublished, bump)
    .on(RoomEvent.TrackUnpublished, bump)
    .on(RoomEvent.ParticipantNameChanged, bump)
    .on(RoomEvent.LocalTrackPublished, () => onLocalTracksChanged(r))
    .on(RoomEvent.LocalTrackUnpublished, () => onLocalTracksChanged(r))
    .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      setV({ speaking: Object.fromEntries(speakers.map((p) => [p.identity, true as const])) });
    })
    .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
      if (topic !== CAPTIONS_TOPIC || !participant) return;
      try {
        const chunk = JSON.parse(new TextDecoder().decode(payload)) as CaptionChunk;
        if (typeof chunk.text === "string") setCaption(participant.identity, chunk);
      } catch {
        // pacote malformado: ignora
      }
    })
    .on(RoomEvent.AudioPlaybackStatusChanged, () => setV({ audioBlocked: !r.canPlaybackAudio }))
    .on(RoomEvent.Reconnecting, () => setV({ status: "reconnecting" }))
    .on(RoomEvent.Reconnected, () => setV({ status: "connected" }))
    .on(RoomEvent.MediaDevicesError, (err: Error) => toast.error(deviceErrorMessage(err)))
    .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      // saída iniciada por nós, ou falha ao conectar (o joinVoice avisa com a mensagem certa)
      if (room !== r || !established.has(r)) return;
      room = null;
      captioner.setActive(false, useSettings.getState().captionsLang);
      clearAudioSink();
      resetCallState();
      realtime.send({ type: "voice.leave" });
      toast.error(disconnectMessage(reason));
    });
}

function onLocalTracksChanged(r: Room) {
  const lp = r.localParticipant;
  setV({ screenSharing: lp.isScreenShareEnabled, cameraOn: lp.isCameraEnabled });
  syncFlags();
  bump();
}

function disconnectMessage(reason?: DisconnectReason): string {
  switch (reason) {
    case DisconnectReason.DUPLICATE_IDENTITY:
      return "Você entrou na voz por outra aba ou aparelho, então esta saiu.";
    case DisconnectReason.PARTICIPANT_REMOVED:
      return "Você foi removido da chamada.";
    case DisconnectReason.ROOM_DELETED:
      return "O canal de voz foi encerrado.";
    default:
      return "A conexão de voz caiu. Entre de novo no canal.";
  }
}

// ---------------------------------------------------------------- áudio

let sinkEl: HTMLDivElement | null = null;
function sink(): HTMLDivElement {
  if (!sinkEl) {
    sinkEl = document.createElement("div");
    sinkEl.id = "audio-sink";
    sinkEl.hidden = true;
    document.body.appendChild(sinkEl);
  }
  return sinkEl;
}

function attachAudio(track: RemoteTrack) {
  sink().appendChild(track.attach());
}

function clearAudioSink() {
  if (sinkEl) sinkEl.replaceChildren();
}

function applyVolumes() {
  const r = room;
  if (!r) return;
  const { deafened } = useVoice.getState();
  const volumes = useSettings.getState().userVolumes;
  for (const p of r.remoteParticipants.values()) {
    const v = deafened ? 0 : (volumes[p.identity] ?? 1);
    p.setVolume(v, Track.Source.Microphone);
    p.setVolume(v, Track.Source.ScreenShareAudio);
  }
}

/** Alguns navegadores bloqueiam áudio até um clique: chamado pelo botão "Ativar som". */
export async function unlockAudio(): Promise<void> {
  await room?.startAudio();
  setV({ audioBlocked: room ? !room.canPlaybackAudio : false });
}

// ---------------------------------------------------------------- microfone

function micOptions() {
  const s = useSettings.getState();
  return {
    ...(s.micDeviceId ? { deviceId: s.micDeviceId } : {}),
    echoCancellation: s.echoCancellation,
    noiseSuppression: s.noiseSuppression,
    autoGainControl: true,
  };
}

/** Microfone deve estar aberto agora? */
function micShouldBeLive(): boolean {
  const v = useVoice.getState();
  const s = useSettings.getState();
  return !v.muted && !v.deafened && (!s.pttEnabled || v.pttActive);
}

// As operações de microfone são assíncronas; enfileirar garante que o estado final
// seja sempre o mais recente, mesmo apertando o push-to-talk muito rápido.
let micChain: Promise<void> = Promise.resolve();
function applyMic(): Promise<void> {
  micChain = micChain.then(doApplyMic, doApplyMic);
  return micChain;
}

async function doApplyMic() {
  const r = room;
  if (!r || r.state !== ConnectionState.Connected) return;
  try {
    await r.localParticipant.setMicrophoneEnabled(micShouldBeLive(), micOptions());
  } catch (err) {
    setV({ muted: true });
    syncFlags();
    toast.error(deviceErrorMessage(err));
  }
  updateCaptioner();
  bump();
}

function deviceErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError") {
    return "O navegador bloqueou o microfone/câmera. Libere no cadeado ao lado do endereço do site.";
  }
  if (name === "NotFoundError") return "Nenhum microfone ou câmera encontrado.";
  if (name === "NotReadableError") return "O dispositivo está sendo usado por outro programa.";
  return "Não foi possível acessar o dispositivo de áudio/vídeo.";
}

export function toggleMute() {
  const v = useVoice.getState();
  // Como no Discord: ligar o microfone enquanto ensurdecido também volta a ouvir.
  if (v.deafened) setV({ deafened: false, muted: false });
  else setV({ muted: !v.muted });
  afterLocalAudioChange();
}

export function toggleDeafen() {
  setV((s) => ({ deafened: !s.deafened }));
  afterLocalAudioChange();
}

function afterLocalAudioChange() {
  applyVolumes();
  void applyMic();
  syncFlags();
}

// ---------------------------------------------------------------- push-to-talk

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

const MODIFIERS = new Set(["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight"]);

function setPtt(active: boolean) {
  if (useVoice.getState().pttActive === active) return;
  setV({ pttActive: active });
  void applyMic();
}

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    const s = useSettings.getState();
    if (!s.pttEnabled || e.code !== s.pttKey || e.repeat || !room) return;
    if (isTyping(e.target) && !MODIFIERS.has(e.code)) return;
    if (!MODIFIERS.has(e.code)) e.preventDefault();
    setPtt(true);
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === useSettings.getState().pttKey) setPtt(false);
  });
  // Trocar de janela com a tecla apertada não pode deixar o microfone preso aberto.
  window.addEventListener("blur", () => setPtt(false));
}

// ---------------------------------------------------------------- tela e câmera

export async function toggleScreenShare(): Promise<void> {
  const r = room;
  if (!r) return;
  const enable = !r.localParticipant.isScreenShareEnabled;
  try {
    await r.localParticipant.setScreenShareEnabled(enable, {
      audio: true,
      systemAudio: "include",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
      resolution: ScreenSharePresets.h1080fps30.resolution,
    });
  } catch (err) {
    // Cancelar a janela de escolha da tela não é erro.
    if ((err as { name?: string })?.name === "NotAllowedError") return;
    toast.error("Não foi possível compartilhar a tela.");
  } finally {
    onLocalTracksChanged(r);
  }
}

export async function toggleCamera(): Promise<void> {
  const r = room;
  if (!r) return;
  try {
    await r.localParticipant.setCameraEnabled(!r.localParticipant.isCameraEnabled, {
      resolution: VideoPresets.h720.resolution,
    });
  } catch (err) {
    toast.error(deviceErrorMessage(err));
  } finally {
    onLocalTracksChanged(r);
  }
}

// ---------------------------------------------------------------- estado para os outros

function syncFlags() {
  const v = useVoice.getState();
  if (v.status === "idle") return;
  realtime.send({
    type: "voice.flags",
    muted: v.muted || v.deafened,
    deafened: v.deafened,
    streaming: v.screenSharing,
    video: v.cameraOn,
  });
}

// Reconexão do WebSocket: o servidor esqueceu em que canal estávamos, reanuncia.
realtime.onHello(() => {
  const v = useVoice.getState();
  if (v.status !== "idle" && v.channelId && room) {
    realtime.send({ type: "voice.join", channelId: v.channelId });
    syncFlags();
  }
});

// ---------------------------------------------------------------- legendas

function setCaption(identity: string, chunk: CaptionChunk) {
  setV((s) => ({
    captions: { ...s.captions, [identity]: { text: chunk.text.slice(0, 500), final: chunk.final, at: Date.now() } },
  }));
}

let pendingInterim: CaptionChunk | null = null;
let interimTimer: ReturnType<typeof setTimeout> | null = null;

function publishCaption(chunk: CaptionChunk) {
  const r = room;
  if (!r) return;
  const data = new TextEncoder().encode(JSON.stringify(chunk));
  // Final: confiável. Parcial: pode perder pacote, o próximo substitui.
  void r.localParticipant.publishData(data, { reliable: chunk.final, topic: CAPTIONS_TOPIC }).catch(() => undefined);
}

const captioner = new SpeechCaptioner(
  (chunk) => {
    const r = room;
    if (!r) return;
    setCaption(r.localParticipant.identity, chunk);
    if (chunk.final) {
      pendingInterim = null;
      publishCaption(chunk);
      return;
    }
    // Parciais chegam muitas vezes por segundo: envia no máximo ~3 por segundo.
    pendingInterim = chunk;
    interimTimer ??= setTimeout(() => {
      interimTimer = null;
      if (pendingInterim) publishCaption(pendingInterim);
      pendingInterim = null;
    }, 300);
  },
  (message) => {
    useSettings.getState().set({ transcribe: false });
    toast.error(message);
  },
);

/** Só transcreve com consentimento E com o microfone realmente aberto (nunca quando mutado). */
function updateCaptioner() {
  const s = useSettings.getState();
  const active = !!room && useVoice.getState().status !== "idle" && s.transcribe && micShouldBeLive();
  captioner.setActive(active, s.captionsLang);
}

// ---------------------------------------------------------------- mudanças nas preferências

useSettings.subscribe((s, prev) => {
  const r = room;
  if (s.userVolumes !== prev.userVolumes) applyVolumes();
  if (s.pttEnabled !== prev.pttEnabled) {
    setV({ pttActive: false });
    void applyMic();
  }
  if (s.transcribe !== prev.transcribe || s.captionsLang !== prev.captionsLang) updateCaptioner();
  if (!r) return;
  if (s.micDeviceId !== prev.micDeviceId && s.micDeviceId) {
    void r.switchActiveDevice("audioinput", s.micDeviceId).catch((e) => toast.error(deviceErrorMessage(e)));
  }
  if (s.speakerDeviceId !== prev.speakerDeviceId && s.speakerDeviceId) {
    void r.switchActiveDevice("audiooutput", s.speakerDeviceId).catch(() =>
      toast.error("Não foi possível trocar a saída de áudio neste navegador."),
    );
  }
  if (s.noiseSuppression !== prev.noiseSuppression || s.echoCancellation !== prev.echoCancellation) {
    const track = r.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as LocalAudioTrack | undefined;
    void track?.restartTrack(micOptions()).catch((e) => toast.error(deviceErrorMessage(e)));
  }
});

export async function listDevices(kind: MediaDeviceKind): Promise<MediaDeviceInfo[]> {
  try {
    return await Room.getLocalDevices(kind, false);
  } catch {
    return [];
  }
}
