import { useEffect, useState, type FormEvent } from "react";
import { AVATAR_COLORS, DEFAULT_LOOK, LIMITS, PROFILE_COLORS, type Me, type ProfileLook } from "@resenha/shared";
import { GifPicker } from "../chat/GifPicker.tsx";
import { Modal } from "../components/Modal.tsx";
import { api, ApiError } from "../lib/api.ts";
import { ACCENTS, accentColor, BGS, WALLS } from "../lib/theme.ts";
import { notifyPermission, requestNotifyPermission, type NotifyPermission } from "../lib/notify.ts";
import { logout } from "../lib/session.ts";
import { playSound } from "../lib/sounds.ts";
import { useApp } from "../state/app.ts";
import {
  keyLabel,
  useSettings,
  type ChatWall,
  type NoiseMode,
  type NotifyMode,
  type ThemeAccent,
  type ThemeBg,
} from "../state/settings.ts";
import { toast } from "../state/toasts.ts";
import { useUi } from "../state/ui.ts";
import { listDevices } from "../voice/controller.ts";
import { speechSupported } from "../voice/speech.ts";
import { AvatarEditor } from "./AvatarEditor.tsx";
import { MicSensitivity } from "./MicSensitivity.tsx";
import { ProfileCardView } from "./ProfileCard.tsx";
import comemorando from "../assets/mascote/comemorando.webp";

const TABS = [
  { id: "profile", label: "Perfil" },
  { id: "appearance", label: "Aparência" },
  { id: "audio", label: "Áudio" },
  { id: "notifications", label: "Notificações" },
  { id: "captions", label: "Legendas" },
  { id: "account", label: "Conta" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function SettingsModal() {
  const [tab, setTab] = useState<TabId>(() => useUi.getState().settingsTab ?? "profile");
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
        {tab === "appearance" && <AppearanceTab />}
        {tab === "audio" && <AudioTab />}
        {tab === "notifications" && <NotificationsTab />}
        {tab === "captions" && <CaptionsTab />}
        {tab === "account" && <AccountTab />}
      </div>
    </Modal>
  );
}

const FRAMES: { id: ProfileLook["frame"]; label: string }[] = [
  { id: "nenhuma", label: "Nenhuma" },
  { id: "anel", label: "Anel" },
  { id: "duplo", label: "Anel duplo" },
  { id: "tracejado", label: "Tracejado" },
  { id: "halo", label: "Halo" },
];
const NICK_STYLES: { id: ProfileLook["nickStyle"]; label: string }[] = [
  { id: "padrao", label: "Padrão" },
  { id: "cor", label: "Cor do perfil" },
  { id: "gradiente", label: "Degradê" },
];
const FONTS: { id: ProfileLook["font"]; label: string }[] = [
  { id: "onest", label: "Padrão" },
  { id: "mono", label: "Mono" },
  { id: "larga", label: "Larga" },
  { id: "serif", label: "Serifada" },
  { id: "pixel", label: "Pixel" },
];

function ProfileTab() {
  const me = useApp((s) => s.me);
  const [name, setName] = useState(me ? me.displayName : "");
  const [color, setColor] = useState(me ? me.avatarColor : AVATAR_COLORS[0]);
  const [activity, setActivity] = useState(me ? me.activity : "");
  const [note, setNote] = useState(me ? me.note : "");
  const [look, setLook] = useState<ProfileLook>(me ? me.look : DEFAULT_LOOK);
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const patch = (p: Partial<ProfileLook>) => setLook((l) => ({ ...l, ...p }));
  const draft = { ...me, displayName: name || me.displayName, avatarColor: color, activity, note, look };

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { me: updated } = await api.updateMe({ displayName: name, avatarColor: color, activity, note, look });
      useApp.getState().setMe(updated);
      toast.info("Perfil salvo.");
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="profile-editor" onSubmit={save}>
      <div className="form">
        <div className="all-free">
          <img src={comemorando} alt="" width={480} height={437} decoding="async" />
          <p>
            <strong>Tudo liberado.</strong> Capa com GIF, molduras, nick em degradê e fontes: tudo de graça, para todo mundo.
          </p>
        </div>
        <fieldset className="field">
          <legend>Foto de perfil</legend>
          <AvatarEditor onDone={() => undefined} />
        </fieldset>
        <label className="field">
          <span>Nome de exibição</span>
          <input value={name} maxLength={LIMITS.displayNameMax} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field">
          <span>Status</span>
          <input
            value={activity}
            maxLength={LIMITS.activityMax}
            placeholder="maratonando série"
            onChange={(e) => setActivity(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Recado</span>
          <input value={note} maxLength={LIMITS.noteMax} placeholder="uma frase sobre você" onChange={(e) => setNote(e.target.value)} />
        </label>
        <fieldset className="field">
          <legend>{me.avatarUrl ? "Cor do avatar (aparece se a foto não carregar)" : "Cor do avatar"}</legend>
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
        <fieldset className="field">
          <legend>Cor do perfil</legend>
          <small>Aparece no seu cartão, nas molduras e no nick.</small>
          <ColorPicker value={look.a} onChange={(a) => patch({ a })} fallback="Cor do avatar" />
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={look.twoTone} onChange={(e) => patch({ twoTone: e.target.checked })} />
          <span>
            Duas cores
            <small>Pinta o cartão e as molduras com uma segunda cor, que também fecha o degradê do nick.</small>
          </span>
        </label>
        {(look.twoTone || look.nickStyle === "gradiente") && (
          <fieldset className="field">
            <legend>Segunda cor</legend>
            <ColorPicker value={look.b} onChange={(b) => patch({ b })} fallback="Padrão" />
          </fieldset>
        )}
        <Choice label="Capa" value={look.banner} options={[{ id: "cor", label: "Cor do perfil" }, { id: "imagem", label: "Imagem ou GIF" }]} onChange={(banner) => patch({ banner })} />
        {look.banner === "imagem" && <BannerUpload hasBanner={!!me.bannerUrl} />}
        <Choice label="Moldura do avatar" value={look.frame} options={FRAMES} onChange={(frame) => patch({ frame })} />
        <Choice label="Estilo do nick" value={look.nickStyle} options={NICK_STYLES} onChange={(nickStyle) => patch({ nickStyle })} />
        <Choice label="Fonte do nick" value={look.font} options={FONTS} onChange={(font) => patch({ font })} />
        <button className="btn btn-primary" disabled={busy}>
          Salvar perfil
        </button>
      </div>
      <aside className="profile-editor-preview" aria-label="Prévia do seu cartão">
        <span className="mono-label">prévia</span>
        <ProfileCardView user={draft} shown={me.status} />
      </aside>
    </form>
  );
}

/** Paleta do perfil; o primeiro botão volta para a cor padrão. */
function ColorPicker({ value, onChange, fallback }: { value: string | null; onChange(c: string | null): void; fallback: string }) {
  return (
    <div className="swatches">
      <button type="button" className="swatch swatch-none" aria-label={fallback} title={fallback} aria-pressed={value === null} onClick={() => onChange(null)} />
      {PROFILE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className="swatch"
          style={{ background: c }}
          aria-label={`Cor ${c}`}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange(v: T): void;
}) {
  return (
    <fieldset className="field">
      <legend>{label}</legend>
      <div className="choice-row">
        {options.map((o) => (
          <button key={o.id} type="button" className="choice" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** A capa é enviada na hora (como a foto); "Salvar perfil" cuida do resto. */
function BannerUpload({ hasBanner }: { hasBanner: boolean }) {
  const [busy, setBusy] = useState(false);
  const [gifAnchor, setGifAnchor] = useState<HTMLElement | null>(null);
  const gifs = useApp((s) => s.features.gifs);
  async function run(task: () => Promise<{ me: Me }>) {
    setBusy(true);
    try {
      const { me } = await task();
      useApp.getState().setMe(me);
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="row-actions">
      {gifs && (
        <button
          type="button"
          className="btn btn-small btn-primary"
          disabled={busy}
          aria-expanded={!!gifAnchor}
          onClick={(e) => setGifAnchor(gifAnchor ? null : e.currentTarget)}
        >
          {busy ? "Salvando capa…" : "Escolher GIF"}
        </button>
      )}
      <label className="btn btn-small btn-outline" aria-disabled={busy || undefined}>
        {gifs ? "Enviar do computador" : hasBanner ? "Trocar imagem ou GIF" : "Escolher imagem ou GIF"}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void run(() => api.uploadBanner(file));
          }}
        />
      </label>
      {hasBanner && (
        <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => void run(api.removeBanner)}>
          Tirar a imagem
        </button>
      )}
      <small className="muted">
        {gifs && "Escolha um GIF ou envie "}PNG, JPEG, WebP ou GIF, até {LIMITS.bannerMaxBytes / 1024 / 1024} MB.
      </small>
      {gifAnchor && (
        <GifPicker
          anchor={gifAnchor}
          onClose={() => setGifAnchor(null)}
          onPick={(g) => {
            setGifAnchor(null);
            void run(() => api.bannerGif(g.imageUrl));
          }}
        />
      )}
    </div>
  );
}

/** Cor de destaque, fundo e fundo do chat: mudam só para você e aparecem na hora. */
function AppearanceTab() {
  const accent = useSettings((s) => s.themeAccent);
  const bg = useSettings((s) => s.themeBg);
  const wall = useSettings((s) => s.chatWall);
  const set = useSettings.getState().set;
  return (
    <div className="form">
      <p className="small-note muted">Muda só para você, neste aparelho, e aparece na hora.</p>
      <fieldset className="field">
        <legend>Cor de destaque</legend>
        <div className="swatches">
          {(Object.keys(ACCENTS) as ThemeAccent[]).map((id) => (
            <button
              key={id}
              type="button"
              className="swatch"
              style={{ background: accentColor(id) }}
              aria-label={ACCENTS[id].label}
              title={ACCENTS[id].label}
              aria-pressed={accent === id}
              onClick={() => set({ themeAccent: id })}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="field">
        <legend>Fundo</legend>
        <div className="choice-row">
          {(Object.keys(BGS) as ThemeBg[]).map((id) => (
            <button
              key={id}
              type="button"
              className="choice choice-swatch"
              style={{ "--sw": BGS[id].bg1 } as React.CSSProperties}
              aria-pressed={bg === id}
              onClick={() => set({ themeBg: id })}
            >
              {BGS[id].label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="field">
        <legend>Fundo do chat</legend>
        <div className="choice-row">
          {(Object.keys(WALLS) as ChatWall[]).map((id) => (
            <button
              key={id}
              type="button"
              className="choice choice-wall"
              style={{ "--wall": WALLS[id].css } as React.CSSProperties}
              aria-pressed={wall === id}
              onClick={() => set({ chatWall: id })}
            >
              {WALLS[id].label}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

const NOISE_MODES: { id: NoiseMode; label: string; hint: string }[] = [
  {
    id: "ai",
    label: "Com IA (recomendado)",
    hint: "Tira teclado, mouse, ventilador e barulho de fundo, até enquanto você fala. A voz fica um pouco menos aguda, como numa boa ligação.",
  },
  { id: "browser", label: "Básica do navegador", hint: "Só tira ruído constante, como ventilador e chiado. Teclado passa." },
  { id: "off", label: "Desligada", hint: "Som puro do microfone. Para quem tem um microfone bom num lugar silencioso." },
];

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
      <fieldset className="field">
        <legend>Redução de ruído</legend>
        {NOISE_MODES.map((m) => (
          <label key={m.id} className="check">
            <input type="radio" name="noise-mode" checked={s.noiseMode === m.id} onChange={() => s.set({ noiseMode: m.id })} />
            <span>
              {m.label}
              <small>{m.hint}</small>
            </span>
          </label>
        ))}
      </fieldset>
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
      <label className="check">
        <input type="checkbox" checked={s.notifyVoiceJoin} onChange={(e) => s.set({ notifyVoiceJoin: e.target.checked })} />
        <span>
          Avisar quando alguém entrar num canal de voz
          <small>Só quando você não está numa chamada. Bom para saber quando a turma começou a jogar.</small>
        </span>
      </label>
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
      <fieldset className="field">
        <legend>Mesa de sons</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={s.soundboardEnabled}
            onChange={(e) => s.set({ soundboardEnabled: e.target.checked })}
          />
          <span>
            Ouvir os sons que a turma toca na chamada
            <small>Desligado, você continua podendo tocar sons para os outros; só não ouve nenhum.</small>
          </span>
        </label>
        {s.soundboardEnabled && (
          <label className="field">
            <span>Volume da mesa de sons: {Math.round(s.soundboardVolume * 100)}%</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s.soundboardVolume}
              onChange={(e) => s.set({ soundboardVolume: Number(e.target.value) })}
            />
          </label>
        )}
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
