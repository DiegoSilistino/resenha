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
import type { Message } from "@resenha/shared";
import { mentionsUser } from "../chat/mentions.ts";
import { displayNameOf, useApp, windowFocused } from "../state/app.ts";
import { useSettings } from "../state/settings.ts";
import { playSound } from "./sounds.ts";

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
  const text = m.content
    .replace(/```[a-z0-9]*\n?([\s\S]*?)```/gi, "$1")
    .replace(/(\*\*|~~|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  const decision = decideNotify({
    mine: m.authorId === s.me.id,
    focused: windowFocused(),
    inActiveChannel: m.channelId === s.activeChannelId,
    mentioned: mentionsUser(m.content, s.me.username),
    mode: settings.notifyMode,
  });
  if (decision === "none") return;
  playSound("message");
  if (decision !== "notify" || notifyPermission() !== "granted") return;

  const channel = s.channels.find((c) => c.id === m.channelId);
  const author = s.users[m.authorId];
  try {
    const n = new Notification(`${displayNameOf(s.users, m.authorId)}${channel ? ` em #${channel.name}` : ""}`, {
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
      navigate?.(`/c/${m.channelId}`);
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
