import { Link } from "react-router";
import { APP_NAME } from "@resenha/shared";
import { conversationTitle, useApp } from "../state/app.ts";
import { keyLabel, useSettings } from "../state/settings.ts";
import { currentRoom, leaveVoice, toggleMute, toggleScreenShare, unlockAudio, useVoice } from "../voice/controller.ts";
import { SignalIcon } from "../voice/SignalIcon.tsx";

const STATUS_TEXT = {
  connecting: "Conectando…",
  reconnecting: "Reconectando…",
} as const;

/** Pílula branca da chamada em andamento, visível em qualquer página (no topo; no celular, acima do menu). */
export function CallPill({ place }: { place: "top" | "bottom" }) {
  const status = useVoice((s) => s.status);
  const channelId = useVoice((s) => s.channelId);
  const sharing = useVoice((s) => s.screenSharing);
  const muted = useVoice((s) => s.muted || s.deafened);
  const audioBlocked = useVoice((s) => s.audioBlocked);
  const ptt = useSettings((s) => s.pttEnabled);
  const pttKey = useSettings((s) => s.pttKey);
  const channel = useApp((s) => s.channels.find((c) => c.id === channelId));
  // chamada numa conversa privada: o nome da pessoa ou do grupo
  const convName = useApp((s) => {
    const conv = channelId ? s.conversations[channelId] : undefined;
    return conv ? conversationTitle(conv, s.users, s.me ? s.me.id : undefined) : null;
  });
  useVoice((s) => s.version); // a qualidade muda junto com a sala
  if (status === "idle" || !channelId) return null;
  const quality = currentRoom()?.localParticipant.connectionQuality;
  const connected = status === "connected";
  const name = convName ?? channel?.name ?? "Canal de voz";
  const href = convName ? `/conversas/${channelId}` : `/c/${channelId}`;

  return (
    <div className="call-pill" data-place={place} data-status={status} role="region" aria-label="Chamada em andamento">
      {connected ? <SignalIcon quality={quality} /> : <span className="call-pill-dot" aria-hidden="true" />}
      <Link to={href} className="call-pill-label" title={`Voltar para ${name}`}>
        {connected ? (convName ? `call com ${name}` : `${name} · ${APP_NAME}`) : STATUS_TEXT[status]}
      </Link>
      {audioBlocked && (
        <button type="button" className="call-pill-btn" data-on onClick={() => void unlockAudio()}>
          Ativar som
        </button>
      )}
      <button
        type="button"
        className="call-pill-btn"
        data-muted={muted || undefined}
        aria-pressed={muted}
        onClick={toggleMute}
        aria-label={muted ? "Ligar microfone" : "Desligar microfone"}
        title={ptt ? `Aperte ${keyLabel(pttKey)} para falar` : muted ? "Ligar microfone" : "Desligar microfone"}
      >
        {muted ? "Mudo" : "Mic"}
      </button>
      <button
        type="button"
        className="call-pill-btn"
        data-live={sharing || undefined}
        aria-pressed={sharing}
        disabled={!connected}
        onClick={() => void toggleScreenShare()}
        aria-label={sharing ? "Parar de compartilhar a tela" : "Compartilhar a tela"}
      >
        {sharing ? "Parar tela" : "Tela"}
      </button>
      <button type="button" className="call-pill-btn call-pill-leave" onClick={() => void leaveVoice()} aria-label="Sair da chamada">
        Sair
      </button>
    </div>
  );
}
