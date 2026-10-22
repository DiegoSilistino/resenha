import { Headphones, HeadphoneOff, Mic, MicOff, Settings } from "lucide-react";
import { Avatar } from "../components/Avatar.tsx";
import { useApp } from "../state/app.ts";
import { useSettings, keyLabel } from "../state/settings.ts";
import { useUi } from "../state/ui.ts";
import { toggleDeafen, toggleMute, useVoice } from "../voice/controller.ts";

export function UserPanel() {
  const me = useApp((s) => s.me);
  const muted = useVoice((s) => s.muted);
  const deafened = useVoice((s) => s.deafened);
  const speaking = useVoice((s) => (me ? !!s.speaking[me.id] : false));
  const ptt = useSettings((s) => s.pttEnabled);
  const pttKey = useSettings((s) => s.pttKey);
  if (!me) return null;

  return (
    <div className="user-panel">
      <Avatar user={me} size={34} speaking={speaking} />
      <div className="user-panel-names">
        <span className="user-panel-name">{me.displayName}</span>
        <span className="user-panel-sub">{ptt ? `Aperte ${keyLabel(pttKey)} para falar` : `@${me.username}`}</span>
      </div>
      <button
        type="button"
        className="icon-btn"
        data-danger={muted || deafened || undefined}
        aria-pressed={muted || deafened}
        onClick={toggleMute}
        aria-label={muted || deafened ? "Ligar microfone" : "Desligar microfone"}
        title={muted || deafened ? "Ligar microfone" : "Desligar microfone"}
      >
        {muted || deafened ? <MicOff size={18} /> : <Mic size={18} />}
      </button>
      <button
        type="button"
        className="icon-btn"
        data-danger={deafened || undefined}
        aria-pressed={deafened}
        onClick={toggleDeafen}
        aria-label={deafened ? "Voltar a ouvir" : "Ensurdecer"}
        title={deafened ? "Voltar a ouvir" : "Ensurdecer"}
      >
        {deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={() => useUi.getState().setSettingsOpen(true)}
        aria-label="Configurações"
        title="Configurações"
      >
        <Settings size={18} />
      </button>
    </div>
  );
}
