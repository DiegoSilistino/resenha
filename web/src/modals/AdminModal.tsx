import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Copy, Download, Hash, Trash2, Volume2 } from "lucide-react";
import type { BackupInfo, Channel, ChannelKind, ClientErrorEntry, ClientErrorKind, PublicUser, Role } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { Modal } from "../components/Modal.tsx";
import { api, BACKUP_DOWNLOAD_URL, type InviteWithUrl } from "../lib/api.ts";
import { formatBytes, formatDay, formatFull, formatTime } from "../lib/format.ts";
import { describeUserAgent } from "../lib/userAgent.ts";
import { displayNameOf, useApp } from "../state/app.ts";
import { useSettings } from "../state/settings.ts";
import { toast } from "../state/toasts.ts";
import { useUi } from "../state/ui.ts";

const TABS = [
  { id: "invites", label: "Convites" },
  { id: "members", label: "Membros" },
  { id: "backup", label: "Backup" },
  { id: "errors", label: "Erros" },
  { id: "feedback", label: "Feedback" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function AdminModal() {
  const hasNewErrors = useHasNewErrors();
  // Feedback é um canal só do criador do site: para os outros admins a aba nem aparece.
  const owner = useApp((s) => s.latestFeedbackId !== null);
  const hasNewFeedback = useApp((s) => s.latestFeedbackId ?? 0) > useSettings((s) => s.feedbackSeenId);
  // Aba pedida por quem abriu; senão, a novidade (feedback, depois erro) abre direto na aba dela.
  const [tab, setTab] = useState<TabId>(
    () => useUi.getState().adminTab ?? (hasNewFeedback ? "feedback" : hasNewErrors ? "errors" : "invites"),
  );
  const tabs = TABS.filter((t) => t.id !== "feedback" || owner);
  return (
    <Modal title="Administrar o site" onClose={() => useUi.getState().setAdminOpen(false)} wide>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className="tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "errors" && hasNewErrors && tab !== "errors" && <span className="unread-dot" aria-label="erros novos" />}
            {t.id === "feedback" && hasNewFeedback && tab !== "feedback" && (
              <span className="unread-dot" aria-label="feedback novo" />
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="tab-panel">
        {tab === "invites" && <InvitesTab />}
        {tab === "members" && <MembersTab />}
        {tab === "backup" && <BackupTab />}
        {tab === "errors" && <ErrorsTab />}
        {tab === "feedback" && owner && <FeedbackTab />}
      </div>
    </Modal>
  );
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.info("Link copiado.");
  } catch {
    prompt("Copie o link:", text);
  }
}

const EXPIRY_OPTIONS = [
  { label: "1 dia", hours: 24 },
  { label: "3 dias", hours: 72 },
  { label: "7 dias", hours: 168 },
  { label: "Não expira", hours: null },
] as const;

function InvitesTab() {
  const [invites, setInvites] = useState<InviteWithUrl[] | null>(null);
  const [role, setRole] = useState<Role>("member");
  const [maxUses, setMaxUses] = useState(1);
  const [expiry, setExpiry] = useState(1);
  const [latest, setLatest] = useState<InviteWithUrl | null>(null);
  // em qual roda a pessoa entra (as rodas em que você está; a primeira é a principal)
  const rodas = Object.values(useApp((s) => s.rodas)).sort((a, b) => a.createdAt - b.createdAt);
  const [rodaId, setRodaId] = useState(rodas[0]?.id ?? "");

  const load = useCallback(() => {
    api
      .invites()
      .then((r) => setInvites(r.invites))
      .catch((err) => toast.fromError(err));
  }, []);
  useEffect(load, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const { invite } = await api.createInvite({
        role,
        maxUses,
        expiresInHours: EXPIRY_OPTIONS[expiry]!.hours,
        ...(rodaId ? { rodaId } : {}),
      });
      setLatest(invite);
      load();
    } catch (err) {
      toast.fromError(err);
    }
  }

  const now = Date.now();
  const active = (invites ?? []).filter(
    (i) => !i.revoked && i.uses < i.maxUses && (i.expiresAt === null || i.expiresAt > now),
  );

  return (
    <div className="form">
      <form className="invite-form" onSubmit={create}>
        {rodas.length > 1 && (
          <label className="field">
            <span>Entra na roda</span>
            <select value={rodaId} onChange={(e) => setRodaId(e.target.value)}>
              {rodas.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Usos</span>
          <select value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))}>
            {[1, 2, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "1 pessoa" : `${n} pessoas`}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Validade</span>
          <select value={expiry} onChange={(e) => setExpiry(Number(e.target.value))}>
            {EXPIRY_OPTIONS.map((o, i) => (
              <option key={o.label} value={i}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Papel</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="member">Membro</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <button className="btn btn-primary">Criar convite</button>
      </form>

      {latest && (
        <div className="callout invite-latest">
          <span>Mande este link para quem você quer convidar:</span>
          <code>{latest.url}</code>
          <button type="button" className="btn btn-small" onClick={() => void copy(latest.url)}>
            <Copy size={14} aria-hidden="true" /> Copiar link
          </button>
        </div>
      )}

      <h3>Convites ativos</h3>
      {invites === null ? (
        <p className="muted">Carregando…</p>
      ) : active.length === 0 ? (
        <p className="muted">Nenhum convite ativo.</p>
      ) : (
        <ul className="admin-list">
          {active.map((i) => (
            <li key={i.code}>
              <div className="admin-list-main">
                <strong>{i.role === "admin" ? "Administrador" : "Membro"}</strong>
                <span className="muted">
                  {i.maxUses === 1 ? "Uso único." : `${i.uses} de ${i.maxUses} usos.`}{" "}
                  {i.expiresAt ? `Vale até ${formatFull(i.expiresAt)}.` : "Não expira."}
                </span>
              </div>
              <button type="button" className="icon-btn" onClick={() => void copy(i.url)} aria-label="Copiar link">
                <Copy size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                data-danger
                aria-label="Revogar convite"
                onClick={async () => {
                  try {
                    await api.revokeInvite(i.code);
                    load();
                  } catch (err) {
                    toast.fromError(err);
                  }
                }}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Todas as contas do servidor (sem as removidas). No resto do app o admin também só vê quem
 * conhece; o painel busca a lista completa para dar para administrar quem ele não conhece.
 */
function useAllUsers() {
  const [users, setUsers] = useState<Record<string, PublicUser> | null>(null);
  const load = useCallback(() => {
    api
      .adminUsers()
      .then((r) => setUsers(Object.fromEntries(r.users.map((u) => [u.id, u]))))
      .catch((err) => toast.fromError(err));
  }, []);
  useEffect(load, [load]);
  return { users, load };
}

function MembersTab() {
  const { users: all, load } = useAllUsers();
  const meId = useApp((s) => (s.me ? s.me.id : null));
  if (!all) return <p className="muted">Carregando…</p>;
  const list = Object.values(all).sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));

  // depois de mudar alguém, recarrega a lista (quem você não conhece não manda atualização ao vivo)
  const run = (p: Promise<unknown>) => p.then(load, (err) => toast.fromError(err));

  async function remove(u: PublicUser) {
    const ok = confirm(
      `Remover a conta de ${u.displayName} (@${u.username}) de vez?\n\n` +
        `A pessoa sai na hora e não consegue mais entrar com ela. O nome @${u.username} fica livre. ` +
        `As mensagens que ela mandou continuam, assinadas como "Ex-membro".\n\nNão dá para desfazer.`,
    );
    if (!ok) return;
    try {
      await api.removeUser(u.id);
      toast.info(`Conta @${u.username} removida.`);
      load();
    } catch (err) {
      toast.fromError(err);
    }
  }

  return (
    <div className="form">
      <p className="muted small-note">
        Desativar desconecta a pessoa e pode ser desfeito. Remover apaga a conta de vez (bom para conta duplicada ou
        de quem saiu do grupo).
      </p>
      <ul className="admin-list">
        {list.map((u) => (
          <li key={u.id} data-disabled={u.disabled || undefined}>
            <Avatar user={u} size={30} />
            <div className="admin-list-main">
              <strong>{u.displayName}</strong>
              <span className="muted">
                @{u.username}
                {u.disabled ? ", desativado" : ""}
              </span>
            </div>
            {u.id !== meId && (
              <>
                <select
                  value={u.role}
                  aria-label={`Papel de ${u.displayName}`}
                  onChange={(e) => void run(api.setUserRole(u.id, e.target.value as Role))}
                >
                  <option value="member">Membro</option>
                  <option value="admin">Administrador</option>
                </select>
                <button
                  type="button"
                  className="btn btn-small"
                  data-danger={!u.disabled || undefined}
                  onClick={() => {
                    if (!u.disabled && !confirm(`Desativar ${u.displayName}? A pessoa é desconectada na hora.`)) return;
                    void run(api.setUserDisabled(u.id, !u.disabled));
                  }}
                >
                  {u.disabled ? "Reativar" : "Desativar"}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  data-danger
                  aria-label={`Remover a conta de ${u.displayName}`}
                  title="Remover a conta de vez"
                  onClick={() => void remove(u)}
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const DAY = 86_400_000;
/** Depois disso, o lembrete de baixar o backup fica em destaque. */
const BACKUP_STALE_DAYS = 7;

function BackupTab() {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const load = useCallback(() => {
    api
      .backupInfo()
      .then(setInfo)
      .catch((err) => toast.fromError(err));
  }, []);

  useEffect(() => {
    load();
    // O download termina fora do app (na barra do navegador): ao voltar para a janela, atualiza a data.
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  if (!info) return <p className="muted">Carregando…</p>;

  const now = Date.now();
  const ageDays = info.lastDownloadAt ? Math.floor((now - info.lastDownloadAt) / DAY) : null;
  const stale = ageDays === null || ageDays >= BACKUP_STALE_DAYS;
  const lowDisk = info.disk !== null && (info.disk.free < 2 * 1024 ** 3 || info.disk.free / info.disk.total < 0.1);
  const newest = info.snapshots[0];

  return (
    <div className="form backup-tab">
      <div className={stale ? "callout callout-warn" : "callout"}>
        <strong>
          {ageDays === null
            ? "Você ainda não baixou nenhum backup."
            : ageDays === 0
              ? "Último backup baixado hoje."
              : `Último backup baixado há ${ageDays} ${ageDays === 1 ? "dia" : "dias"} (${formatFull(info.lastDownloadAt!)}).`}
        </strong>
        <span>
          O backup completo tem as contas, as mensagens, os anexos, as fotos e os sons da mesa. Guarde no PC ou no Google Drive: se a
          VPS se perder, é com ele que o Resenha volta.{stale ? " Vale baixar um agora e repetir toda semana." : ""}
        </span>
      </div>

      <div>
        <a
          className="btn btn-primary"
          href={BACKUP_DOWNLOAD_URL}
          download
          onClick={() => {
            for (const ms of [3_000, 15_000, 60_000]) setTimeout(load, ms);
          }}
        >
          <Download size={16} aria-hidden="true" /> Baixar backup completo (~{formatBytes(info.totalBytes)})
        </a>
      </div>

      <h3>No servidor</h3>
      <ul className="backup-facts">
        <li>
          Cópias diárias do banco: <strong>{info.snapshots.length}</strong>
          {newest ? ` (a mais recente de ${formatDay(newest.createdAt, now).toLowerCase()})` : " (a primeira sai em até 1 hora)"}.
          Servem para voltar atrás se algo for apagado sem querer; ficam as últimas 7.
        </li>
        {info.disk && (
          <li data-warn={lowDisk || undefined}>
            Disco: <strong>{formatBytes(info.disk.free)}</strong> livres de {formatBytes(info.disk.total)}.
            {lowDisk ? " Está acabando: apague anexos grandes antigos ou aumente o plano." : ""}
          </li>
        )}
      </ul>
      <p className="muted small-note">
        Para restaurar, use o comando <code>bash deploy/restore.sh</code> na VPS (o passo a passo está no DEPLOY.md).
      </p>
    </div>
  );
}

/** Tem erro no painel que ainda não foi visto neste aparelho? */
export function useHasNewErrors(): boolean {
  const latest = useApp((s) => s.latestErrorId);
  const seen = useSettings((s) => s.errorsSeenId);
  return latest > seen;
}

const KIND_LABEL: Record<ClientErrorKind, string> = {
  voz: "Chamada",
  microfone: "Microfone ou câmera",
  tela: "Tela",
  ruido: "Redução de ruído",
  inesperado: "Erro do app",
  feedback: "Feedback",
};

const CONTEXT_LABEL: Record<string, string> = {
  pagina: "Página",
  voz: "Voz",
  ruido: "Redução de ruído",
  pushToTalk: "Push-to-talk",
  url: "Servidor de voz",
  motivo: "Motivo",
  perfil: "Qualidade da tela",
  comSom: "Tela com som",
  arquivo: "Arquivo",
};

const VOICE_STATUS: Record<string, string> = {
  idle: "fora da chamada",
  connecting: "entrando",
  connected: "na chamada",
  reconnecting: "reconectando",
};
const NOISE_MODE: Record<string, string> = { ai: "IA", browser: "do navegador", off: "desligada" };

/** Valor legível: nome do canal em vez do endereço, estados em português, sim/não. */
function contextValue(key: string, v: string | number | boolean, channels: Channel[]): string {
  if (typeof v === "boolean") return v ? "sim" : "não";
  const text = String(v);
  if (key === "voz") return VOICE_STATUS[text] ?? text;
  if (key === "ruido") return NOISE_MODE[text] ?? text;
  if (key === "pagina") {
    const id = /^\/c\/([^/]+)/.exec(text)?.[1];
    const channel = id ? channels.find((c) => c.id === id) : undefined;
    if (channel) return channel.kind === "voice" ? `canal de voz ${channel.name}` : `#${channel.name}`;
  }
  return text;
}

/** Detalhe técnico que só repete a mensagem ("Error: <mensagem>") não acrescenta nada. */
const usefulDetail = (e: ClientErrorEntry) => (e.detail && !e.detail.endsWith(e.message) ? e.detail : "");

/** Feedback da tela inicial: canal só seu (criador do site), separado dos erros automáticos. */
function FeedbackTab() {
  const [items, setItems] = useState<ClientErrorEntry[] | null>(null);
  const latest = useApp((s) => s.latestFeedbackId ?? 0);
  const live = useApp((s) => s.users);
  const { users: all } = useAllUsers();
  const users = { ...all, ...live };

  // Recarrega quando chega feedback novo com a aba aberta; e marca tudo como visto.
  useEffect(() => {
    let cancelled = false;
    api
      .adminFeedback()
      .then((r) => {
        if (cancelled) return;
        setItems(r.feedback);
        useSettings.getState().set({ feedbackSeenId: Math.max(latest, r.feedback[0]?.id ?? 0) });
      })
      .catch((err) => toast.fromError(err));
    return () => {
      cancelled = true;
    };
  }, [latest]);

  async function clear() {
    if (!confirm("Apagar todos os feedbacks? Não dá para desfazer.")) return;
    try {
      await api.clearAdminFeedback();
      setItems([]);
    } catch (err) {
      toast.fromError(err);
    }
  }

  if (!items) return <p className="muted">Carregando…</p>;
  if (items.length === 0) {
    return (
      <div className="callout">
        <strong>Nenhum feedback ainda.</strong>
        <span>Quando alguém mandar pela seção Feedback da tela inicial, aparece aqui. Só você vê esta aba.</span>
      </div>
    );
  }

  const now = Date.now();
  return (
    <div className="form errors-tab">
      <div className="errors-head">
        <span className="muted">
          {items.length === 1 ? "1 feedback" : `${items.length} feedbacks`} (os mais recentes primeiro; só você vê)
        </span>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => void clear()}>
          <Trash2 size={14} aria-hidden="true" /> Limpar
        </button>
      </div>
      <ul className="error-list">
        {items.map((e) => (
          <li key={e.id} className="error-item" data-kind="feedback">
            <div className="error-top">
              <Avatar user={users[e.userId]} size={20} />
              <strong>{displayNameOf(users, e.userId)}</strong>
              <time className="muted" dateTime={new Date(e.createdAt).toISOString()} title={formatFull(e.createdAt)}>
                {formatDay(e.createdAt, now)} às {formatTime(e.createdAt)}
              </time>
            </div>
            <p className="error-message">{e.message}</p>
            <p className="error-meta muted">{describeUserAgent(e.userAgent)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ErrorsTab() {
  const [errors, setErrors] = useState<ClientErrorEntry[] | null>(null);
  const latest = useApp((s) => s.latestErrorId);
  // nome de quem mandou, mesmo que o admin não conheça a pessoa (a lista ao vivo, se tiver, vale mais)
  const live = useApp((s) => s.users);
  const { users: all } = useAllUsers();
  const users = { ...all, ...live };
  const channels = useApp((s) => s.channels);

  // Recarrega quando chega um erro novo com a aba aberta; e marca tudo como visto.
  useEffect(() => {
    let cancelled = false;
    api
      .adminErrors()
      .then((r) => {
        if (cancelled) return;
        setErrors(r.errors);
        const newest = Math.max(latest, r.errors[0]?.id ?? 0);
        useSettings.getState().set({ errorsSeenId: newest });
      })
      .catch((err) => toast.fromError(err));
    return () => {
      cancelled = true;
    };
  }, [latest]);

  async function clear() {
    if (!confirm("Apagar todos os erros registrados?")) return;
    try {
      await api.clearAdminErrors();
      setErrors([]);
    } catch (err) {
      toast.fromError(err);
    }
  }

  if (!errors) return <p className="muted">Carregando…</p>;

  if (errors.length === 0) {
    return (
      <div className="callout">
        <strong>Nenhum erro registrado.</strong>
        <span>
          Quando algo falhar no navegador de alguém (entrar na chamada, microfone, tela, redução de ruído), aparece aqui
          com o que a pessoa viu e os detalhes técnicos. Assim você não depende de print.
        </span>
      </div>
    );
  }

  const now = Date.now();
  return (
    <div className="form errors-tab">
      <div className="errors-head">
        <span className="muted">
          {errors.length === 1 ? "1 erro" : `${errors.length} erros`} (os mais recentes primeiro; ficam os últimos 500)
        </span>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => void clear()}>
          <Trash2 size={14} aria-hidden="true" /> Limpar
        </button>
      </div>
      <ul className="error-list">
        {errors.map((e) => {
          const detail = usefulDetail(e);
          const context = Object.entries(e.context).filter(([, v]) => v !== "");
          return (
            <li key={e.id} className="error-item" data-kind={e.kind}>
              <div className="error-top">
                <span className="error-kind">{KIND_LABEL[e.kind] ?? e.kind}</span>
                <Avatar user={users[e.userId]} size={20} />
                <strong>{displayNameOf(users, e.userId)}</strong>
                <time className="muted" dateTime={new Date(e.createdAt).toISOString()} title={formatFull(e.createdAt)}>
                  {formatDay(e.createdAt, now)} às {formatTime(e.createdAt)}
                </time>
              </div>
              <p className="error-message">{e.message}</p>
              <p className="error-meta muted">{describeUserAgent(e.userAgent)}</p>
              {(detail || context.length > 0) && (
                <details>
                  <summary>Detalhes técnicos</summary>
                  <dl className="error-context">
                    {context.map(([k, v]) => (
                      <div key={k}>
                        <dt>{CONTEXT_LABEL[k] ?? k}</dt>
                        <dd>{contextValue(k, v, channels)}</dd>
                      </div>
                    ))}
                  </dl>
                  {detail && <pre className="error-detail">{detail}</pre>}
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
