import { useEffect, useState, type FormEvent } from "react";
import { AVATAR_COLORS, LIMITS } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { Modal } from "../components/Modal.tsx";
import { api, ApiError } from "../lib/api.ts";
import { notifyPermission, requestNotifyPermission, type NotifyPermission } from "../lib/notify.ts";
import { logout } from "../lib/session.ts";
import { playSound } from "../lib/sounds.ts";
import { useApp } from "../state/app.ts";
import { keyLabel, useSettings, type NotifyMode } from "../state/settings.ts";
import { toast } from "../state/toasts.ts";
import { useUi } from "../state/ui.ts";
import { listDevices } from "../voice/controller.ts";
import { speechSupported } from "../voice/speech.ts";
import { AvatarEditor } from "./AvatarEditor.tsx";
import { MicSensitivity } from "./MicSensitivity.tsx";

const TABS = [
  { id: "profile", label: "Perfil" },
  { id: "audio", label: "Áudio" },
  { id: "notifications", label: "Notificações" },
  { id: "captions", label: "Legendas" },
  { id: "account", label: "Conta" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function SettingsModal() {
  const [tab, setTab] = useState<TabId>("profile");
  return (
    <Modal title="Configurações" onClose={() => useUi.getState().setSettingsOpen(false)} wide>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className="tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="tab-panel">
        {tab === "profile" && <ProfileTab />}
        {tab === "audio" && <AudioTab />}
        {tab === "notifications" && <NotificationsTab />}
        {tab === "captions" && <CaptionsTab />}
        {tab === "account" && <AccountTab />}
      </div>
    </Modal>
  );
}

function ProfileTab() {
  const me = useApp((s) => s.me);
  const [name, setName] = useState(me ? me.displayName : "");
  const [color, setColor] = useState(me ? me.avatarColor : AVATAR_COLORS[0]);
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { me: updated } = await api.updateMe({ displayName: name, avatarColor: color });
      useApp.getState().setMe(updated);
      toast.info("Perfil salvo.");
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <div className="profile-preview">
        <Avatar user={{ displayName: name || me.displayName, avatarColor: color, avatarUrl: me.avatarUrl }} size={64} />
        <div>
          <strong>{name || me.displayName}</strong>
          <div className="muted">@{me.username}</div>
        </div>
      </div>
      <fieldset className="field">
        <legend>Foto de perfil</legend>
        <AvatarEditor onDone={() => undefined} />
      </fieldset>
      <label className="field">
        <span>Nome de exibição</span>
        <input value={name} maxLength={LIMITS.displayNameMax} onChange={(e) => setName(e.target.value)} required />
      </label>
      <fieldset className="field">
        <legend>{me.avatarUrl ? "Cor (aparece se a foto não carregar)" : "Cor do avatar"}</legend>
        <div className="swatches">
          {AVATAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="swatch"
              style={{ background: c }}
              aria-label={`Cor ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </fieldset>
      <button className="btn btn-primary" disabled={busy}>
        Salvar perfil
      </button>
    </form>
  );
}

function AudioTab() {
  const s = useSettings();
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [capturing, setCapturing] = useState(false);

  const refresh = async () => {
    setMics(await listDevices("audioinput"));
    setSpeakers(await listDevices("audiooutput"));
  };
  useEffect(() => {
    void refresh();
  }, []);

  // Sem permissão, o navegador esconde o nome dos dispositivos.
  const needsPermission = mics.length > 0 && mics.every((d) => !d.label);

  async function askPermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await refresh();
    } catch {
      toast.error("Permissão negada. Libere o microfone no cadeado ao lado do endereço do site.");
    }
  }

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== "Escape") useSettings.getState().set({ pttKey: e.code });
      setCapturing(false);
    };
    window.addEventListener("keydown", onKey, { capture: true, once: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [capturing]);

  return (
    <div className="form">
      {needsPermission && (
        <p className="callout">
          Para listar seus microfones pelo nome, permita o acesso.{" "}
          <button type="button" className="link-btn" onClick={() => void askPermission()}>
            Permitir microfone
          </button>
        </p>
      )}
      <label className="field">
        <span>Microfone</span>
        <select value={s.micDeviceId ?? ""} onChange={(e) => s.set({ micDeviceId: e.target.value || null })}>
          <option value="">Padrão do sistema</option>
          {mics.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Microfone ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
      {speakers.length > 0 && (
        <label className="field">
          <span>Saída de áudio</span>
          <select value={s.speakerDeviceId ?? ""} onChange={(e) => s.set({ speakerDeviceId: e.target.value || null })}>
            <option value="">Padrão do sistema</option>
            {speakers.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Saída ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={s.noiseSuppression}
          onChange={(e) => s.set({ noiseSuppression: e.target.checked })}
        />
        <span>
          Redução de ruído
          <small>Filtra teclado, ventilador e barulho de fundo.</small>
        </span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={s.echoCancellation}
          onChange={(e) => s.set({ echoCancellation: e.target.checked })}
        />
        <span>
          Cancelamento de eco
          <small>Desligue só se usar fone e quiser o som mais natural.</small>
        </span>
      </label>
      <label className="check">
        <input type="checkbox" checked={s.pttEnabled} onChange={(e) => s.set({ pttEnabled: e.target.checked })} />
        <span>
          Apertar para falar (push-to-talk)
          <small>O microfone só abre enquanto a tecla estiver apertada, com esta janela em foco.</small>
        </span>
      </label>
      {s.pttEnabled && (
        <div className="field">
          <span>Tecla</span>
          <button type="button" className="btn key-capture" onClick={() => setCapturing(true)}>
            {capturing ? "Aperte a tecla desejada (Esc cancela)" : keyLabel(s.pttKey)}
          </button>
        </div>
      )}
      <MicSensitivity />
    </div>
  );
}

const NOTIFY_MODES: { id: NotifyMode; label: string; hint: string }[] = [
  { id: "all", label: "Todas as mensagens", hint: "Bom para um grupo pequeno de amigos." },
  { id: "mentions", label: "Só quando me mencionarem", hint: "Quando alguém escrever @seu-usuario." },
  { id: "none", label: "Nunca", hint: "Sem notificação e sem som de mensagem." },
];

const PERMISSION_TEXT: Record<NotifyPermission, string> = {
  granted: "Ativadas neste navegador.",
  default: "Ainda não ativadas neste navegador.",
  denied: "Bloqueadas neste navegador. Para liberar, clique no cadeado ao lado do endereço do site e permita as notificações.",
  unsupported: "Este navegador não tem notificações. Use o Chrome ou o Edge.",
};

function NotificationsTab() {
  const s = useSettings();
  const [permission, setPermission] = useState(notifyPermission);

  async function enable() {
    const result = await requestNotifyPermission();
    setPermission(result);
    if (result === "granted") {
      try {
        new Notification("Notificações do Resenha ativadas", { body: "É assim que as mensagens novas vão aparecer.", icon: "/icon-192.png" });
      } catch {
        // navegador que só notifica via service worker: a permissão ficou salva mesmo assim
      }
    }
  }

  return (
    <div className="form">
      <div className="field">
        <span>Notificações do Windows</span>
        <p className="muted notify-status">{PERMISSION_TEXT[permission]}</p>
        {permission === "default" && (
          <div>
            <button type="button" className="btn btn-primary btn-small" onClick={() => void enable()}>
              Ativar notificações
            </button>
          </div>
        )}
        <small>Aparecem quando o Resenha está minimizado ou em outra janela. Com ele aberto na sua frente, nada pisca.</small>
      </div>
      <fieldset className="field">
        <legend>Avisar sobre</legend>
        {NOTIFY_MODES.map((m) => (
          <label key={m.id} className="check">
            <input type="radio" name="notify-mode" checked={s.notifyMode === m.id} onChange={() => s.set({ notifyMode: m.id })} />
            <span>
              {m.label}
              <small>{m.hint}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="field">
        <legend>Sons</legend>
        <label className="check">
          <input type="checkbox" checked={s.notifySound} onChange={(e) => s.set({ notifySound: e.target.checked })} />
          <span>
            Som de mensagem nova
            <small>Toca junto com a notificação.</small>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.callSounds} onChange={(e) => s.set({ callSounds: e.target.checked })} />
          <span>
            Sons da chamada
            <small>Quando alguém entra ou sai da voz, e quando você muta ou ensurdece.</small>
          </span>
        </label>
        <label className="field">
          <span>Volume dos sons: {Math.round(s.soundVolume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.soundVolume}
            onChange={(e) => s.set({ soundVolume: Number(e.target.value) })}
            onPointerUp={() => playSound("join")}
            onKeyUp={() => playSound("join")}
          />
        </label>
        <div className="row-actions">
          <button type="button" className="btn btn-small" onClick={() => playSound("message")}>
            Ouvir som de mensagem
          </button>
          <button type="button" className="btn btn-small" onClick={() => playSound("join")}>
            Ouvir som de entrada
          </button>
        </div>
      </fieldset>
    </div>
  );
}

function CaptionsTab() {
  const s = useSettings();
  const supported = speechSupported();
  return (
    <div className="form">
      <p className="muted">
        Cada pessoa transcreve a própria fala e o texto aparece para quem ligou as legendas. Sem custo e sem gravação
        no servidor.
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={s.captionsView}
          onChange={(e) => s.set({ captionsView: e.target.checked })}
        />
        <span>Mostrar legendas na chamada</span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={s.transcribe}
          disabled={!supported}
          onChange={(e) => s.set({ transcribe: e.target.checked })}
        />
        <span>
          Transcrever minha fala
          <small>
            {supported
              ? "Usa o reconhecimento de voz do navegador: no Chrome o áudio vai para o Google; no Edge, para a Microsoft. Nunca transcreve com o microfone desligado."
              : "Seu navegador não suporta. Use Chrome ou Edge para transcrever."}
          </small>
        </span>
      </label>
      <label className="field">
        <span>Idioma da sua fala</span>
        <select value={s.captionsLang} onChange={(e) => s.set({ captionsLang: e.target.value })}>
          <option value="pt-BR">Português (Brasil)</option>
          <option value="pt-PT">Português (Portugal)</option>
          <option value="en-US">Inglês</option>
          <option value="es-ES">Espanhol</option>
        </select>
      </label>
    </div>
  );
}

function AccountTab() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function change(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      toast.info("Senha alterada. Outros aparelhos conectados foram desconectados.");
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fields, _: err.message });
      else toast.fromError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form">
      <form className="form" onSubmit={change}>
        <h3>Trocar senha</h3>
        <label className="field" data-invalid={errors.currentPassword ? true : undefined}>
          <span>Senha atual</span>
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
          {errors.currentPassword && <small className="field-error">{errors.currentPassword}</small>}
        </label>
        <label className="field" data-invalid={errors.newPassword ? true : undefined}>
          <span>Nova senha</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={LIMITS.passwordMin}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
          <small className={errors.newPassword ? "field-error" : undefined}>
            {errors.newPassword ?? `Pelo menos ${LIMITS.passwordMin} caracteres`}
          </small>
        </label>
        <button className="btn btn-primary" disabled={busy}>
          Trocar senha
        </button>
      </form>
      <hr />
      <button
        type="button"
        className="btn btn-danger"
        onClick={() => {
          useUi.getState().setSettingsOpen(false);
          void logout();
        }}
      >
        Sair da conta
      </button>
    </div>
  );
}
