import { Link } from "react-router";
import { Monitor, MonitorOff, PhoneOff, Volume2 } from "lucide-react";
import { useApp } from "../state/app.ts";
import { currentRoom, leaveVoice, toggleScreenShare, unlockAudio, useVoice } from "../voice/controller.ts";
import { SignalIcon } from "../voice/SignalIcon.tsx";

const STATUS_TEXT = {
  connecting: "Conectando…",
  connected: "Voz conectada",
  reconnecting: "Reconectando…",
} as const;

/** Faixa acima do seu perfil enquanto você está numa chamada (visível em qualquer página). */
export function VoiceBar() {
  const status = useVoice((s) => s.status);
  const channelId = useVoice((s) => s.channelId);
  const sharing = useVoice((s) => s.screenSharing);
  const audioBlocked = useVoice((s) => s.audioBlocked);
  const channel = useApp((s) => s.channels.find((c) => c.id === channelId));
  useVoice((s) => s.version); // a qualidade muda junto com a sala
  if (status === "idle" || !channelId) return null;
  const quality = currentRoom()?.localParticipant.connectionQuality;

  return (
    <div className="voice-bar" data-status={status}>
      <div className="voice-bar-info">
        <span className="voice-bar-status">
          {status === "connected" && <SignalIcon quality={quality} />}
          {STATUS_TEXT[status]}
        </span>
        <Link to={`/c/${channelId}`} className="voice-bar-channel">
          {channel?.name ?? "Canal de voz"}
        </Link>
      </div>
      {audioBlocked && (
        <button type="button" className="btn btn-small btn-primary" onClick={() => void unlockAudio()}>
          <Volume2 size={14} /> Ativar som
        </button>
      )}
      <button
        type="button"
        className="icon-btn"
        aria-pressed={sharing}
        disabled={status !== "connected"}
        onClick={() => void toggleScreenShare()}
        aria-label={sharing ? "Parar de compartilhar a tela" : "Compartilhar a tela"}
        title={sharing ? "Parar de compartilhar a tela" : "Compartilhar a tela"}
      >
        {sharing ? <MonitorOff size={18} /> : <Monitor size={18} />}
      </button>
      <button
        type="button"
        className="icon-btn"
        data-danger
        onClick={() => void leaveVoice()}
        aria-label="Sair da chamada"
        title="Sair da chamada"
      >
        <PhoneOff size={18} />
      </button>
    </div>
  );
}
