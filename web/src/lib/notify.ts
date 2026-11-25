/**
 * Notificações do Windows (Notification API) e o "plim" de mensagem nova.
 *
 * Regras, iguais às do Discord:
 * - nunca avisa das suas próprias mensagens;
 * - com a janela em foco, não abre notificação (você já está vendo); só toca o som
 *   se te mencionarem em outro canal;
 * - com a janela minimizada ou em segundo plano, avisa conforme a preferência
 *   (todas as mensagens, só menções ou nada).
 */
import type { CallRing, Message, VoiceMember } from "@resenha/shared";
import { plainText } from "../chat/plain.ts";
import { conversationTitle, displayNameOf, mentionsMe, useApp, windowFocused } from "../state/app.ts";
import { useSettings } from "../state/settings.ts";
import { toast } from "../state/toasts.ts";
import { playSound } from "./sounds.ts";
import { useVoice } from "../voice/state.ts";
import { leaveVoice } from "../voice/controller.ts";

export type NotifyPermission = NotificationPermission | "unsupported";

export function notifyPermission(): NotifyPermission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** Precisa ser chamado direto de um clique (o navegador exige um gesto). */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (typeof Notification === "undefined") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

let navigate: ((path: string) => void) | null = null;
/** O Shell registra a navegação do React Router aqui, para o clique na notificação abrir o canal. */
export function setNotifyNavigator(fn: ((path: string) => void) | null) {
  navigate = fn;
}

const open = new Set<Notification>();
/** Notificação do sistema de cada chamada tocando para você (fecha quando para de tocar). */
const ringing = new Map<string, Notification>();

/**
 * Chamada tocando para você com o app em segundo plano: notificação do sistema que fica até parar de
 * tocar (com o app na frente, a tela de chamada recebida basta).
 */
export function onRing(channelId: string, ring: CallRing | null): void {
  const s = useApp.getState();
  if (!s.me || !ring?.pending.includes(s.me.id)) {
    ringing.get(channelId)?.close();
    ringing.delete(channelId);
    return;
  }
  if (ringing.has(channelId) || windowFocused() || notifyPermission() !== "granted") return;
  const conv = s.conversations[channelId];
  const who = displayNameOf(s.users, ring.callerId);
  try {
    const n = new Notification(conv?.type === "group" ? `${who} está ligando em ${conversationTitle(conv, s.users, s.me.id)}` : `${who} está te ligando`, {
      body: "Abra o Resenha para atender ou recusar.",
      icon: s.users[ring.callerId]?.avatarUrl ?? "/icon-192.png",
      tag: `chamada-${channelId}`,
      requireInteraction: true,
      silent: true,
    });
    ringing.set(channelId, n);
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // sem notificação via página neste navegador: o toque já avisa
  }
}

/** Recusaram ou não atenderam: quem está na chamada fica sabendo; na conversa a dois, ela acaba (como no telefone). */
export function onCallDeclined(channelId: string, userId: string, reason: "recusou" | "nao-atendeu"): void {
  const s = useApp.getState();
  const v = useVoice.getState();
  if (v.status === "idle" || v.channelId !== channelId) return;
  const who = displayNameOf(s.users, userId);
  toast.info(reason === "recusou" ? `${who} recusou a chamada.` : `${who} não atendeu.`);
  if (s.conversations[channelId]?.type === "dm" && (s.voice[channelId]?.length ?? 0) <= 1) void leaveVoice();
}

export type NotifyDecision = "none" | "sound" | "notify";

/** Decide o que fazer com uma mensagem nova (função pura, testável). */
export function decideNotify(input: {
  mine: boolean;
  focused: boolean;
  inActiveChannel: boolean;
  mentioned: boolean;
  mode: "all" | "mentions" | "none";
}): NotifyDecision {
  const { mine, focused, inActiveChannel, mentioned, mode } = input;
  if (mine || mode === "none") return "none";
  if (mode === "mentions" && !mentioned) return "none";
  if (focused) return mentioned && !inActiveChannel ? "sound" : "none";
  return "notify";
}

/** Texto curto para a notificação: sem marcação, e anexos viram uma descrição. */
export function notificationBody(m: Pick<Message, "content" | "attachments">): string {
  const text = plainText(m.content);
  if (text === "GIF") return "Enviou um GIF";
  if (text) return text.length > 140 ? `${text.slice(0, 139)}…` : text;
  const n = m.attachments.length;
  if (n === 0) return "";
  const images = m.attachments.every((a) => a.mime.startsWith("image/"));
  if (images) return n === 1 ? "Enviou uma imagem" : `Enviou ${n} imagens`;
  return n === 1 ? "Enviou um arquivo" : `Enviou ${n} arquivos`;
}

export function onNewMessage(m: Message): void {
  const s = useApp.getState();
  if (!s.me) return;
  const settings = useSettings.getState();
  const conv = s.conversations[m.channelId];
  // Conversa privada conta como menção: é com você.
  const mentioned = !!conv || mentionsMe(m, s.me);
  // Chat de canal de voz é conversa de quem está na call: fora dela, só avisa se te mencionarem.
  const voiceChat = s.channels.find((c) => c.id === m.channelId)?.kind === "voice";
  if (voiceChat && !mentioned && useVoice.getState().channelId !== m.channelId) return;
  const decision = decideNotify({
    mine: m.authorId === s.me.id,
    focused: windowFocused(),
    inActiveChannel: m.channelId === s.activeChannelId,
    mentioned,
    mode: settings.notifyMode,
  });
  if (decision === "none") return;
  playSound("message");
  if (decision !== "notify" || notifyPermission() !== "granted") return;

  const channel = s.channels.find((c) => c.id === m.channelId);
  const author = s.users[m.authorId];
  try {
    const where = conv
      ? conv.type === "group"
        ? ` em ${conversationTitle(conv, s.users, s.me.id)}`
        : ""
      : channel
        ? channel.kind === "voice"
          ? ` no chat de ${channel.name}`
          : ` em #${channel.name}`
        : "";
    const n = new Notification(`${displayNameOf(s.users, m.authorId)}${where}`, {
      body: notificationBody(m),
      icon: author?.avatarUrl ?? "/icon-192.png",
      // Uma notificação por canal: a nova substitui a anterior em vez de empilhar.
      tag: `canal-${m.channelId}`,
      // O "plim" do app já tocou; sem isso o Windows tocaria o dele também.
      silent: true,
    });
    open.add(n);
    n.onclose = () => open.delete(n);
    n.onclick = () => {
      window.focus();
      navigate?.(conv ? `/conversas/${m.channelId}` : `/c/${m.channelId}`);
      n.close();
    };
  } catch {
    // alguns navegadores só permitem notificação via service worker: o som já avisou
  }
}

/** Voltou para a janela: limpa as notificações que ficaram na Central de Ações. */
function onBack() {
  if (!windowFocused()) return;
  for (const n of open) n.close();
  open.clear();
  useApp.getState().markWindowSeen();
}

if (typeof window !== "undefined") {
  window.addEventListener("focus", onBack);
  document.addEventListener("visibilitychange", onBack);
}

// ---------------------------------------------------------------- alguém entrou na voz (opcional)

/** Quem caiu e voltou em menos disso não gera aviso (oscilação de rede). */
const REJOIN_QUIET_MS = 60_000;
const lastLeft = new Map<string, number>();

/** Quem entrou na lista de um canal de voz (sem você, sem quem só reconectou). */
export function joinedMembers(
  prev: Pick<VoiceMember, "userId">[],
  next: Pick<VoiceMember, "userId">[],
  meId: string,
  now: number,
  recentlyLeft: Map<string, number>,
): string[] {
  const before = new Set(prev.map((m) => m.userId));
  const after = new Set(next.map((m) => m.userId));
  for (const id of before) if (!after.has(id)) recentlyLeft.set(id, now);
  return [...after].filter((id) => !before.has(id) && id !== meId && now - (recentlyLeft.get(id) ?? -Infinity) > REJOIN_QUIET_MS);
}

/** Chamado a cada atualização de canal de voz vinda do servidor (nunca no "hello" inicial). */
export function onVoiceMembers(channelId: string, prev: VoiceMember[], next: VoiceMember[]): void {
  const s = useApp.getState();
  if (!s.me) return;
  const joined = joinedMembers(prev, next, s.me.id, Date.now(), lastLeft);
  const conv = s.conversations[channelId];
  // Sala da roda: só com o aviso ligado. Conversa privada é ligação para você: avisa sempre.
  // Em ambos, só com você fora de chamadas (dentro de uma, o som da call já avisa).
  if (joined.length === 0 || (!conv && !useSettings.getState().notifyVoiceJoin)) return;
  if (conv && s.rings[channelId]) return; // está tocando: a tela de chamada recebida já avisa
  if (useVoice.getState().status !== "idle") return;

  const channel = s.channels.find((c) => c.id === channelId);
  const who = joined.map((id) => displayNameOf(s.users, id)).join(" e ");
  const title = conv
    ? `${who} ${conv.type === "group" ? `ligou em ${conversationTitle(conv, s.users, s.me.id)}` : "está te ligando"}`
    : `${who} ${joined.length > 1 ? "entraram" : "entrou"} em ${channel?.name ?? "um canal de voz"}`;
  playSound("friendJoined");
  if (windowFocused()) {
    toast.info(title);
    return;
  }
  if (notifyPermission() !== "granted") return;
  const names = next.map((m) => displayNameOf(s.users, m.userId));
  try {
    const n = new Notification(title, {
      body: names.length > 1 ? `Na chamada agora: ${names.join(", ")}` : "Clique para ver o canal.",
      icon: s.users[joined[0]!]?.avatarUrl ?? "/icon-192.png",
      tag: `voz-${channelId}`,
      silent: true,
    });
    open.add(n);
    n.onclose = () => open.delete(n);
    n.onclick = () => {
      window.focus();
      navigate?.(conv ? `/conversas/${channelId}` : `/c/${channelId}`);
      n.close();
    };
  } catch {
    // sem notificação via página neste navegador: o som já avisou
  }
}
