import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Copy, Hash, Trash2, Volume2 } from "lucide-react";
import type { ChannelKind, Role } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { Modal } from "../components/Modal.tsx";
import { api, type InviteWithUrl } from "../lib/api.ts";
import { formatFull } from "../lib/format.ts";
import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";
import { useUi } from "../state/ui.ts";

const TABS = [
  { id: "invites", label: "Convites" },
  { id: "channels", label: "Canais" },
  { id: "members", label: "Membros" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function AdminModal() {
  const [tab, setTab] = useState<TabId>("invites");
  return (
    <Modal title="Administrar o grupo" onClose={() => useUi.getState().setAdminOpen(false)} wide>
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
        {tab === "invites" && <InvitesTab />}
        {tab === "channels" && <ChannelsTab />}
        {tab === "members" && <MembersTab />}
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

function ChannelsTab() {
  const channels = useApp((s) => s.channels);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ChannelKind>("text");

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await api.createChannel(name, kind);
      setName("");
    } catch (err) {
      toast.fromError(err);
    }
  }

  /** Troca a posição com o vizinho (as posições são reescritas em sequência). */
  async function move(index: number, delta: -1 | 1) {
    const order = [...channels];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target]!, order[index]!];
    try {
      await Promise.all(order.map((c, position) => (c.position === position ? null : api.updateChannel(c.id, { position }))));
    } catch (err) {
      toast.fromError(err);
    }
  }

  return (
    <div className="form">
      <form className="invite-form" onSubmit={create}>
        <label className="field grow">
          <span>Novo canal</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="nome-do-canal" required />
        </label>
        <label className="field">
          <span>Tipo</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as ChannelKind)}>
            <option value="text">Texto</option>
            <option value="voice">Voz</option>
          </select>
        </label>
        <button className="btn btn-primary">Criar</button>
      </form>
      <ul className="admin-list">
        {channels.map((c, i) => (
          <li key={c.id}>
            {c.kind === "text" ? <Hash size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
            <input
              className="inline-input"
              defaultValue={c.name}
              aria-label={`Nome do canal ${c.name}`}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value && value !== c.name) {
                  api.updateChannel(c.id, { name: value }).catch((err) => {
                    e.target.value = c.name;
                    toast.fromError(err);
                  });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
            <button type="button" className="icon-btn" disabled={i === 0} onClick={() => void move(i, -1)} aria-label="Subir">
              <ArrowUp size={16} />
            </button>
            <button
              type="button"
              className="icon-btn"
              disabled={i === channels.length - 1}
              onClick={() => void move(i, 1)}
              aria-label="Descer"
            >
              <ArrowDown size={16} />
            </button>
            <button
              type="button"
              className="icon-btn"
              data-danger
              aria-label={`Apagar ${c.name}`}
              onClick={async () => {
                if (!confirm(`Apagar "${c.name}" e todas as mensagens dele? Não dá para desfazer.`)) return;
                try {
                  await api.deleteChannel(c.id);
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
    </div>
  );
}

function MembersTab() {
  const users = useApp((s) => s.users);
  const meId = useApp((s) => (s.me ? s.me.id : null));
  const list = Object.values(users).sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));

  const run = (p: Promise<unknown>) => p.catch((err) => toast.fromError(err));

  return (
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
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
