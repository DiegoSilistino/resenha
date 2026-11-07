/**
 * Motor da chamada de voz (LiveKit), carregado sob demanda pela fachada (controller.ts).
 * Fica fora do React: a conexão sobrevive à troca de páginas, igual ao Discord.
 */
import {
  ConnectionError,
  ConnectionErrorReason,
  ConnectionState,
  DisconnectReason,
  type LocalAudioTrack,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
} from "livekit-client";
import { CAPTIONS_TOPIC } from "@resenha/shared";
import { api, ApiError } from "../lib/api.ts";
import { realtime } from "../lib/realtime.ts";
import { reportError } from "../lib/errors.ts";
import { playSound } from "../lib/sounds.ts";
import { useSettings } from "../state/settings.ts";
import { toast } from "../state/toasts.ts";
import { SpeechCaptioner, type CaptionChunk } from "./speech.ts";
import { screenQuality, screenShareErrorAdvice, screenShareOptions, type ScreenQualityId } from "./screenQuality.ts";
import { useUi } from "../state/ui.ts";
import { micChainConfig, micOptions } from "./controller.ts";
import { MicProcessor } from "./gate/processor.ts";
import { useVoice } from "./state.ts";
import { participantVolumes } from "./volumes.ts";

const setV = useVoice.setState;
const bump = () => setV((s) => ({ version: s.version + 1 }));

let room: Room | null = null;
let joinSeq = 0;
/** Cadeia do microfone (IA + sensibilidade) da chamada atual. */
let gate: MicProcessor | null = null;
/** Até quando ignorar entradas/saídas dos outros (a reconexão da sala gera eventos em rajada). */
let quietUntil = 0;
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
  if (room) await leaveVoice({ sound: false });

  const seq = ++joinSeq;
  quietUntil = 0;
  setV({ status: "connecting", channelId, screenSharing: false, cameraOn: false, speaking: {}, captions: {} });
  let r: Room | null = null;
  let url = "";
  try {
    const credentials = await api.voiceToken(channelId);
    url = credentials.url;
    const { token } = credentials;
    if (seq !== joinSeq) return;

    const s = useSettings.getState();
    r = new Room({
      // "screen": usa a escala real da tela (125%/150% no Windows) para pedir a camada
      // de vídeo certa; sem isso, quem assiste recebe uma resolução abaixo da que vê.
      adaptiveStream: { pixelDensity: "screen" },
      dynacast: true,
      // Mixagem via Web Audio: permite volume individual acima de 100%.
      webAudioMix: true,
      audioCaptureDefaults: micOptions(),
      audioOutput: s.speakerDeviceId ? { deviceId: s.speakerDeviceId } : undefined,
      publishDefaults: {
        dtx: true,
        red: true,
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
    playSound("join");
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
    console.error("[voz] falha ao conectar em", url || "(sem URL)", err);
    const message = joinErrorMessage(err, url);
    toast.error(message);
    reportError("voz", message, err, { url, ...(err instanceof ConnectionError ? { motivo: String(err.reason) } : {}) });
  }
}

/**
 * O servidor já confirmou que o LiveKit está no ar antes de liberar o token; então,
 * se falhou aqui, o problema está entre ESTE navegador e o LiveKit.
 */
export function joinErrorMessage(err: unknown, url: string): string {
  if (err instanceof ApiError) return err.message; // ex.: "O servidor de voz não está rodando…"
  if (err instanceof ConnectionError) {
    if (err.reason === ConnectionErrorReason.NotAllowed) {
      return "O servidor de voz recusou a entrada (credenciais do LiveKit diferentes das do app).";
    }
    if (err.reason === ConnectionErrorReason.Cancelled) return "Conexão de voz cancelada.";
    if (/pc connection/i.test(err.message) || err.reason === ConnectionErrorReason.Timeout) {
      return import.meta.env.DEV
        ? "Conectou ao servidor de voz, mas o áudio não passou. Se o Windows perguntou sobre o Firewall, permita o livekit-server e tente de novo."
        : "Conectou ao servidor de voz, mas o áudio não passou: libere as portas 7881/TCP e 7882/UDP no servidor (e confira o firewall da sua rede).";
    }
    return `Seu navegador não alcançou o servidor de voz em ${url}. ${
      import.meta.env.DEV
        ? "Ele está rodando? Veja as linhas [voz] no terminal do npm run dev."
        : "Confira LIVEKIT_PUBLIC_URL e o encaminhamento de /rtc no Caddy."
    }`;
  }
  return "Não foi possível conectar à voz. Tente de novo; se continuar, recarregue a página.";
}

/** `sound: false` ao trocar de canal (só toca o som de entrar no novo). */
export async function leaveVoice({ sound = true }: { sound?: boolean } = {}): Promise<void> {
  joinSeq++;
  const r = room;
  room = null;
  gate = null;
  if (r && sound) playSound("leave");
  captioner.setActive(false, useSettings.getState().captionsLang);
  if (r) await r.disconnect().catch(() => undefined);
  clearAudioSink();
  resetCallState();
  realtime.send({ type: "voice.leave" });
}

function resetCallState() {
  useUi.getState().setShareDialogOpen(false);
  setV((s) => ({
    status: "idle",
    channelId: null,
    screenSharing: false,
    cameraOn: false,
    pttActive: false,
    audioBlocked: false,
    speaking: {},
    captions: {},
    watching: {},
    focused: null,
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
    .on(RoomEvent.ParticipantConnected, () => {
      if (room === r && performance.now() > quietUntil) playSound("join");
      bump();
    })
    .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      // Ao sairmos, o LiveKit "desconecta" cada participante: room já é null aqui e nada toca.
      if (room === r && performance.now() > quietUntil) playSound("leave");
      setV((s) => {
        const captions = { ...s.captions };
        delete captions[p.identity];
        return { captions, version: s.version + 1 };
      });
    })
    .on(RoomEvent.ConnectionQualityChanged, bump)
    .on(RoomEvent.TrackMuted, bump)
    .on(RoomEvent.TrackUnmuted, bump)
    .on(RoomEvent.TrackPublished, bump)
    .on(RoomEvent.TrackUnpublished, (pub: RemoteTrackPublication, p: RemoteParticipant) => {
      // Parou de transmitir: se voltar, a turma clica em Assistir de novo (como no Discord).
      if (pub.source === Track.Source.ScreenShare && useVoice.getState().watching[p.identity]) {
        setV((s) => {
          const watching = { ...s.watching };
          delete watching[p.identity];
          return { watching };
        });
      }
      bump();
    })
    .on(RoomEvent.ParticipantNameChanged, bump)
    .on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
      onLocalTracksChanged(r);
      if (pub.source === Track.Source.Microphone && pub.track) void attachGate(pub.track as LocalAudioTrack);
    })
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
    .on(RoomEvent.Reconnecting, () => {
      quietUntil = Infinity;
      setV({ status: "reconnecting" });
    })
    .on(RoomEvent.Reconnected, () => {
      quietUntil = performance.now() + 2_000;
      setV({ status: "connected" });
    })
    .on(RoomEvent.MediaDevicesError, (err: Error) => {
      // Falhas da captura de tela têm aviso próprio (em startScreenShare); este é de microfone/câmera.
      if (capturingScreen) return;
      toast.error(deviceErrorMessage(err));
      reportError("microfone", deviceErrorMessage(err), err);
    })
    .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      // saída iniciada por nós, ou falha ao conectar (o joinVoice avisa com a mensagem certa)
      if (room !== r || !established.has(r)) return;
      room = null;
      gate = null;
      playSound("leave");
      captioner.setActive(false, useSettings.getState().captionsLang);
      clearAudioSink();
      resetCallState();
      realtime.send({ type: "voice.leave" });
      // O próprio LiveKit desconecta ao fechar ou recarregar a página: não é queda.
      if (reason === DisconnectReason.CLIENT_INITIATED) return;
      toast.error(disconnectMessage(reason));
      if (isUnexpectedDisconnect(reason)) {
        reportError("voz", disconnectMessage(reason), undefined, { motivo: DisconnectReason[reason ?? 0] ?? String(reason) });
      }
    });
}

function onLocalTracksChanged(r: Room) {
  const lp = r.localParticipant;
  setV({ screenSharing: lp.isScreenShareEnabled, cameraOn: lp.isCameraEnabled });
  syncFlags();
  bump();
}

/** Saídas com motivo conhecido (outra aba, removido, sala encerrada) não são erro para o painel. */
function isUnexpectedDisconnect(reason?: DisconnectReason): boolean {
  return (
    reason !== DisconnectReason.DUPLICATE_IDENTITY &&
    reason !== DisconnectReason.PARTICIPANT_REMOVED &&
    reason !== DisconnectReason.ROOM_DELETED
  );
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

export function applyVolumes() {
  const r = room;
  if (!r) return;
  const { deafened, streamMuted, watching } = useVoice.getState();
  const { userVolumes, streamVolumes } = useSettings.getState();
  for (const p of r.remoteParticipants.values()) {
    const v = participantVolumes({
      deafened,
      voice: userVolumes[p.identity],
      stream: streamVolumes[p.identity],
      // Tela que você não abriu fica muda. O vídeo dela nem chega: sem <video> ligado, o adaptiveStream pausa a faixa.
      streamMuted: !!streamMuted[p.identity] || !watching[p.identity],
    });
    p.setVolume(v.voice, Track.Source.Microphone);
    p.setVolume(v.stream, Track.Source.ScreenShareAudio);
  }
}

/** Alguns navegadores bloqueiam áudio até um clique: chamado pelo botão "Ativar som". */
export async function unlockAudio(): Promise<void> {
  await room?.startAudio();
  setV({ audioBlocked: room ? !room.canPlaybackAudio : false });
}

// ---------------------------------------------------------------- microfone

let warnedAi = false;
function aiUnavailable() {
  if (warnedAi) return;
  warnedAi = true;
  reportError("ruido", "A redução de ruído com IA não carregou");
  toast.error(
    "A redução de ruído com IA não funcionou neste navegador. Em Configurações → Áudio, escolha a básica do navegador.",
  );
}

async function attachGate(track: LocalAudioTrack) {
  if (track.getProcessor()) return;
  const g = new MicProcessor(micChainConfig, aiUnavailable);
  try {
    await track.setProcessor(g);
    gate = g;
  } catch (err) {
    // sem a cadeia a chamada funciona igual, só sem IA e sem cortar o ruído entre as falas
    console.warn("[voz] não foi possível ligar a redução de ruído e a sensibilidade", err);
    reportError("ruido", "Não foi possível ligar a redução de ruído e a sensibilidade", err);
    if (useSettings.getState().noiseMode === "ai") aiUnavailable();
  }
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
    reportError("microfone", deviceErrorMessage(err), err);
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

/** Mute/ensurdecer mudaram na fachada: aplica na sala. */
export function afterLocalAudioChange() {
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

/** Botão de tela: se já transmite, para; senão abre a escolha de qualidade. */
export function toggleScreenShare(): void {
  if (room?.localParticipant.isScreenShareEnabled) void stopScreenShare();
  else if (room) useUi.getState().setShareDialogOpen(true);
}

export async function stopScreenShare(): Promise<void> {
  const r = room;
  if (!r) return;
  try {
    await r.localParticipant.setScreenShareEnabled(false);
  } finally {
    onLocalTracksChanged(r);
  }
}

/** Começa a transmitir. Chame direto do clique (o navegador exige um gesto para abrir a escolha de tela). */
let capturingScreen = false;

/** Começa a transmitir. Chame direto do clique (o navegador exige um gesto para abrir a escolha de tela). */
export async function startScreenShare(qualityId: ScreenQualityId, withAudio: boolean): Promise<void> {
  const r = room;
  if (!r) return;
  useSettings.getState().set({ screenQuality: qualityId, screenAudio: withAudio });
  const { capture, publish } = screenShareOptions(screenQuality(qualityId), { audio: withAudio });
  capturingScreen = true;
  try {
    await r.localParticipant.setScreenShareEnabled(true, capture, publish);
  } catch (err) {
    const advice = screenShareErrorAdvice(err, qualityId);
    if (advice.message) {
      const e = err as { name?: string; message?: string };
      console.error(`[voz] falha ao transmitir a tela (perfil ${qualityId}): ${e?.name}: ${e?.message}`, err);
      toast.error(advice.message);
      reportError("tela", advice.message, err, { perfil: qualityId, comSom: withAudio });
    }
    if (advice.retryWith) {
      // Reabre a escolha já no perfil sugerido: tentar de novo é um clique.
      useSettings.getState().set({
        screenQuality: advice.retryWith,
        ...(advice.retryWithoutAudio ? { screenAudio: false } : {}),
      });
      useUi.getState().setShareDialogOpen(true);
    }
  } finally {
    capturingScreen = false;
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
    reportError("microfone", `Câmera: ${deviceErrorMessage(err)}`, err);
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
  if (s.userVolumes !== prev.userVolumes || s.streamVolumes !== prev.streamVolumes) applyVolumes();
  if (s.pttEnabled !== prev.pttEnabled) {
    setV({ pttActive: false });
    void applyMic();
  }
  if (s.transcribe !== prev.transcribe || s.captionsLang !== prev.captionsLang) updateCaptioner();
  if (
    s.micGate !== prev.micGate ||
    s.micGateAuto !== prev.micGateAuto ||
    s.micGateDb !== prev.micGateDb ||
    s.pttEnabled !== prev.pttEnabled
  ) {
    gate?.reconfigure();
  }
  if (!r) return;
  if (s.micDeviceId !== prev.micDeviceId && s.micDeviceId) {
    void r.switchActiveDevice("audioinput", s.micDeviceId).catch((e) => toast.error(deviceErrorMessage(e)));
  }
  if (s.speakerDeviceId !== prev.speakerDeviceId && s.speakerDeviceId) {
    void r.switchActiveDevice("audiooutput", s.speakerDeviceId).catch(() =>
      toast.error("Não foi possível trocar a saída de áudio neste navegador."),
    );
  }
  // Reiniciar o microfone também reconstrói a cadeia (o LiveKit chama restart no processador).
  if (s.noiseMode !== prev.noiseMode || s.echoCancellation !== prev.echoCancellation) {
    const track = r.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as LocalAudioTrack | undefined;
    void track?.restartTrack(micOptions()).catch((e) => toast.error(deviceErrorMessage(e)));
  }
});
