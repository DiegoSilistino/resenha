/**
 * Criptografia de ponta a ponta das chamadas (voz, câmera e tela), no modelo do Discord (DAVE):
 * - cada pessoa cifra os próprios quadros de áudio e vídeo com uma chave só dela (AES-GCM, no worker do LiveKit);
 * - essa chave muda sempre que alguém entra ou sai: quem saiu não ouve o que vem depois, quem entrou não abre o que veio antes;
 * - a chave vai para cada participante cifrada com a chave da dupla (ECDH por chamada): o servidor só repassa o que não abre;
 * - o código de segurança (o "código de privacidade de voz" do Discord) mostra se alguém trocou chaves no meio.
 * O Discord combina as chaves com MLS; aqui é a troca por pares (como o Signal faz em grupo), que para o tamanho de uma call
 * dá a mesma garantia com bem menos código.
 */
import E2EEWorker from "livekit-client/e2ee-worker?worker";
import { BaseKeyProvider, createKeyMaterialFromBuffer, isE2EESupported, type RemoteParticipant, type Room, RoomEvent } from "livekit-client";
import { captionKey, newIdentity, open, pairKey, privacyCode, seal, type Identity, type Sealed } from "./e2eeCrypto.ts";
import { useVoice } from "./state.ts";

export const e2eeSupported = (): boolean => isE2EESupported();

const TOPIC = "e2ee";
const KEYRING = 16;
/** Espera todo mundo receber a chave nova antes de passar a usá-la (quadro com chave que ainda não chegou se perde). */
const SWITCH_DELAY_MS = 1_000;
/** Várias entradas/saídas juntas (reconexão) viram uma troca só. */
const ROTATE_DEBOUNCE_MS = 300;
/** De quanto em quanto tempo se apresentar de novo para quem ainda não combinou a chave. */
const RETRY_MS = 2_000;

type Msg = { t: "pub"; pub: string; reply?: true } | { t: "key"; i: number; k: Sealed };

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Uma chave por participante (e por índice), como o LiveKit espera com `sharedKey: false`. */
class SenderKeys extends BaseKeyProvider {
  constructor() {
    // sem catraca automática nem "chave inválida": a troca de chaves é toda nossa
    super({ sharedKey: false, ratchetWindowSize: 0, failureTolerance: -1, keyringSize: KEYRING });
  }
  async use(identity: string, raw: Uint8Array<ArrayBuffer>, index: number) {
    this.onSetEncryptionKey(await createKeyMaterialFromBuffer(raw.buffer), identity, index);
  }
}

export class CallEncryption {
  readonly keyProvider = new SenderKeys();
  readonly worker: Worker = new E2EEWorker();
  private me!: Identity;
  private room: Room | null = null;
  private localId = "";
  /** Quem já mandou a chave pública, com a chave da dupla. */
  private peers = new Map<string, { pub: string; key: CryptoKey }>();
  /** Chaves das legendas por remetente e índice. */
  private captionKeys = new Map<string, CryptoKey>();
  /** A chave mais nova (já entregue) e o índice da que está cifrando agora. */
  private latest = { raw: new Uint8Array(32), index: 0 };
  private active = 0;
  private chain: Promise<void> = Promise.resolve();
  private rotateTimer: ReturnType<typeof setTimeout> | undefined;
  private switchTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;

  /** Antes de conectar: o par de chaves desta chamada. */
  async prepare(): Promise<void> {
    this.me = await newIdentity();
  }

  /** Depois de conectar e antes de publicar o microfone: primeira chave, escuta e apresentação para a sala. */
  async start(room: Room): Promise<void> {
    this.room = room;
    this.localId = room.localParticipant.identity;
    room
      .on(RoomEvent.DataReceived, this.onData)
      .on(RoomEvent.ParticipantConnected, this.onJoined)
      .on(RoomEvent.ParticipantDisconnected, this.onLeft);
    await this.newKey(0, true);
    this.send({ t: "pub", pub: this.me.pub });
    // pacote perdido ou chegado antes da hora: quem ainda não combinou a chave recebe a apresentação de novo
    this.retryTimer = setInterval(() => {
      for (const id of this.room?.remoteParticipants.keys() ?? []) if (!this.peers.has(id)) this.send({ t: "pub", pub: this.me.pub }, id);
    }, RETRY_MS);
    void this.updateCode();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.rotateTimer);
    clearTimeout(this.switchTimer);
    clearInterval(this.retryTimer);
    this.room
      ?.off(RoomEvent.DataReceived, this.onData)
      .off(RoomEvent.ParticipantConnected, this.onJoined)
      .off(RoomEvent.ParticipantDisconnected, this.onLeft);
    this.room = null;
    this.worker.terminate();
  }

  /** Legenda que eu mando: cifrada com a chave que está valendo agora. */
  async sealCaption(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
    const key = this.captionKeys.get(`${this.localId}|${this.active}`);
    if (!key) return null;
    const sealed = await seal(key, data, `legenda|${this.localId}|${this.active}`);
    return enc.encode(JSON.stringify({ i: this.active, ...sealed }));
  }

  /** Legenda que chegou: null se ainda não tenho a chave de quem falou (ou se o pacote não confere). */
  async openCaption(from: string, payload: Uint8Array): Promise<Uint8Array | null> {
    try {
      const { i, iv, ct } = JSON.parse(dec.decode(payload)) as { i: number } & Sealed;
      const key = this.captionKeys.get(`${from}|${i}`);
      return key ? await open(key, { iv, ct }, `legenda|${from}|${i}`) : null;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------ chaves

  /** Chave nova: entrega para todos e, depois de um instante, passa a cifrar com ela. */
  private async newKey(index: number, now: boolean) {
    clearTimeout(this.switchTimer);
    const raw = crypto.getRandomValues(new Uint8Array(32));
    this.latest = { raw, index };
    this.captionKeys.set(`${this.localId}|${index}`, await captionKey(raw));
    await Promise.all([...this.peers.keys()].map((id) => this.sendKey(id)));
    const use = () => {
      if (this.stopped) return;
      this.active = index;
      void this.keyProvider.use(this.localId, raw, index);
    };
    if (now) use();
    else this.switchTimer = setTimeout(use, SWITCH_DELAY_MS);
  }

  private rotate() {
    clearTimeout(this.rotateTimer);
    this.rotateTimer = setTimeout(() => {
      if (!this.stopped) void this.newKey((this.latest.index + 1) % KEYRING, false);
    }, ROTATE_DEBOUNCE_MS);
  }

  private onJoined = (p: RemoteParticipant) => {
    // quem já estava também se apresenta: não depende de a apresentação de quem entrou chegar primeiro
    this.send({ t: "pub", pub: this.me.pub }, p.identity);
    this.rotate();
    void this.updateCode();
  };

  private onLeft = (p: RemoteParticipant) => {
    this.peers.delete(p.identity);
    for (const k of this.captionKeys.keys()) if (k.startsWith(`${p.identity}|`)) this.captionKeys.delete(k);
    this.rotate();
    void this.updateCode();
  };

  private async sendKey(to: string) {
    const peer = this.peers.get(to);
    if (!peer) return;
    const { raw, index } = this.latest;
    this.send({ t: "key", i: index, k: await seal(peer.key, raw, `${this.localId}>${to}|${index}`) }, to);
  }

  private send(msg: Msg, to?: string) {
    const room = this.room;
    if (!room || this.stopped) return;
    void room.localParticipant
      .publishData(enc.encode(JSON.stringify(msg)), { reliable: true, topic: TOPIC, ...(to ? { destinationIdentities: [to] } : {}) })
      .catch(() => undefined);
  }

  private onData = (
    payload: Uint8Array,
    participant?: RemoteParticipant,
    _kind?: unknown,
    topic?: string,
    _encryption?: unknown,
    senderIdentity?: string,
  ) => {
    // o pacote pode chegar antes do aviso de que a pessoa entrou (aí `participant` ainda não existe)
    const from = participant?.identity ?? senderIdentity;
    if (topic !== TOPIC || !from) return;
    let msg: Msg;
    try {
      msg = JSON.parse(dec.decode(payload)) as Msg;
    } catch {
      return;
    }
    // em fila: a chave de alguém só se abre depois que a chave pública dele foi processada
    this.chain = this.chain.then(() => this.handle(from, msg)).catch((err: unknown) => console.warn("[e2ee] pacote ignorado", err));
  };

  private async handle(from: string, msg: Msg) {
    if (this.stopped) return;
    if (msg.t === "pub" && typeof msg.pub === "string") {
      if (this.peers.get(from)?.pub !== msg.pub) {
        this.peers.set(from, { pub: msg.pub, key: await pairKey(this.me, msg.pub, this.localId, from) });
        void this.updateCode();
      }
      if (!msg.reply) this.send({ t: "pub", pub: this.me.pub, reply: true }, from);
      await this.sendKey(from);
      return;
    }
    if (msg.t === "key") {
      const peer = this.peers.get(from);
      if (!peer || !Number.isInteger(msg.i) || msg.i < 0 || msg.i >= KEYRING) return;
      const raw = await open(peer.key, msg.k, `${from}>${this.localId}|${msg.i}`);
      if (!raw || raw.length !== 32) return;
      await this.keyProvider.use(from, raw, msg.i);
      this.captionKeys.set(`${from}|${msg.i}`, await captionKey(raw));
    }
  }

  /** Código de segurança e quem ainda não combinou a chave (app desatualizado, por exemplo). */
  private async updateCode() {
    const room = this.room;
    if (!room) return;
    const waiting = [...room.remoteParticipants.keys()].filter((id) => !this.peers.has(id));
    const entries: [string, string][] = [[this.localId, this.me.pub], ...[...this.peers].map(([id, p]): [string, string] => [id, p.pub])];
    const code = await privacyCode(entries);
    if (!this.stopped) useVoice.setState({ e2ee: { code, waiting } });
  }
}
