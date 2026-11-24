import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ChevronDown, ChevronUp, Copy, Trash2 } from "lucide-react";
import { LIMITS, PERMISSIONS, type Invite, type Permission, type Roda, type RodaRole } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { BannerEditor, BannerPicker, type BannerPos, type PendingBanner } from "../components/Banner.tsx";
import { AvatarEditor } from "./AvatarEditor.tsx";
import { Modal } from "../components/Modal.tsx";
import { Nick } from "../components/Nick.tsx";
import { api } from "../lib/api.ts";
import { moveRoom } from "../lib/rodas.ts";
import { isRodaOwner, rodaColor, rodaPerms, roleOf, useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";
import { useUi, type RodaSettingsTab } from "../state/ui.ts";

const PERM_LABELS: Record<Permission, string> = {
  ver: "Ver as salas",
  enviar: "Mandar mensagens",
  anexar: "Mandar arquivos",
  voz: "Entrar nas calls",
  tela: "Mostrar a tela",
  convidar: "Convidar e aprovar pedidos",
  salas: "Criar e editar salas",
  expulsar: "Tirar pessoas e apagar mensagens dos outros",
};

const HUES = [40, 85, 125, 160, 215, 260, 305, 350];

/** Faz a chamada e mostra o erro, se houver (o estado novo chega pelo tempo real). */
async function run(task: () => Promise<unknown>, ok?: string) {
  try {
    await task();
    if (ok) toast.info(ok);
    return true;
  } catch (err) {
    toast.fromError(err);
    return false;
  }
}

export function RodaSettingsModal() {
  const open = useUi((s) => s.rodaSettings)!;
  const roda = useApp((s) => s.rodas[open.rodaId]);
  const me = useApp((s) => s.me);
  const close = () => useUi.getState().openRodaSettings(null);
  const [tab, setTab] = useState<RodaSettingsTab>(open.tab);
  if (!roda) return null;

  const owner = isRodaOwner(roda, me);
  const perms = rodaPerms(roda, me);
  const tabs: { id: RodaSettingsTab; label: string; show: boolean; badge?: number }[] = [
    { id: "geral", label: "Geral", show: owner },
    { id: "cargos", label: "Cargos", show: owner },
    { id: "membros", label: "Membros", show: owner || perms.has("expulsar") },
    { id: "convites", label: "Convites", show: perms.has("convidar"), badge: roda.requests.length },
    { id: "salas", label: "Salas", show: perms.has("salas") },
  ];
  const visible = tabs.filter((t) => t.show);
  const current = visible.some((t) => t.id === tab) ? tab : visible[0]?.id;

  return (
    <Modal title={`Ajustes de ${roda.name}`} onClose={close} wide>
      <div className="tabs" role="tablist">
        {visible.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={current === t.id} className="tab" onClick={() => setTab(t.id)}>
            {t.label}
            {!!t.badge && <span className="tab-badge">{t.badge}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="tab-panel">
        {current === "geral" && <GeneralTab roda={roda} onDeleted={close} />}
        {current === "cargos" && <RolesTab roda={roda} />}
        {current === "membros" && <MembersTab roda={roda} canSetRole={owner} canKick={perms.has("expulsar")} />}
        {current === "convites" && <InvitesTab roda={roda} />}
        {current === "salas" && <RoomsTab roda={roda} />}
        {!current && <p className="muted">Seu cargo não mexe nos ajustes desta roda.</p>}
      </div>
    </Modal>
  );
}

function GeneralTab({ roda, onDeleted }: { roda: Roda; onDeleted(): void }) {
  const [name, setName] = useState(roda.name);
  const [description, setDescription] = useState(roda.description);
  const [hue, setHue] = useState(roda.hue);
  const [privacy, setPrivacy] = useState(roda.privacy);
  const [pos, setPos] = useState<BannerPos>({ bannerX: roda.bannerX, bannerY: roda.bannerY, bannerZoom: roda.bannerZoom });
  const [pendingBanner, setPendingBanner] = useState<PendingBanner | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  // a prévia de um arquivo usa uma URL local, que precisa ser liberada quando sai de cena
  useEffect(() => () => void (pendingBanner?.kind === "file" && URL.revokeObjectURL(pendingBanner.url)), [pendingBanner]);
  const bannerSrc = pendingBanner?.url ?? roda.bannerUrl;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    // a capa nova sobe primeiro; posição e zoom vão junto com o resto
    await run(async () => {
      if (pendingBanner) {
        await (pendingBanner.kind === "gif" ? api.rodaBannerGif(roda.id, pendingBanner.url) : api.uploadRodaBanner(roda.id, pendingBanner.file));
        setPendingBanner(null);
      }
      await api.updateRoda(roda.id, { name: name.trim(), description: description.trim(), hue, privacy, ...pos });
    }, "Roda salva.");
    setBusy(false);
  }

  async function remove() {
    const typed = prompt(`Apagar ${roda.name} com todas as salas e mensagens? Não dá para desfazer.\nDigite o nome da roda para confirmar:`);
    if (typed?.trim() !== roda.name) return;
    if (await run(() => api.deleteRoda(roda.id), "Roda apagada.")) {
      onDeleted();
      void navigate("/rodas", { replace: true });
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <label className="field">
        <span>Nome</span>
        <input value={name} maxLength={LIMITS.rodaNameMax} required onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Descrição</span>
        <input value={description} maxLength={LIMITS.noteMax} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <fieldset className="field">
        <legend>Cor</legend>
        <div className="swatches">
          {HUES.map((h) => (
            <button key={h} type="button" className="swatch" style={{ background: rodaColor(h) }} aria-label={`Cor ${h}`} aria-pressed={hue === h} onClick={() => setHue(h)} />
          ))}
        </div>
      </fieldset>
      <fieldset className="field">
        <legend>Foto</legend>
        <AvatarEditor
          hasImage={!!roda.iconUrl}
          upload={(image) => api.uploadRodaIcon(roda.id, image)}
          remove={() => api.removeRodaIcon(roda.id)}
          square
        />
        <small className="muted">Aparece no lugar das iniciais. Vale na hora, sem precisar salvar.</small>
      </fieldset>
      <fieldset className="field">
        <legend>Capa</legend>
        <BannerPicker
          hasSaved={!!roda.bannerUrl}
          pending={!!pendingBanner}
          onPick={(p) => {
            setPendingBanner(p);
            setPos({ bannerX: 50, bannerY: 50, bannerZoom: 1 }); // imagem nova começa centralizada
          }}
          onDiscard={() => {
            setPendingBanner(null);
            setPos({ bannerX: roda.bannerX, bannerY: roda.bannerY, bannerZoom: roda.bannerZoom });
          }}
          onRemove={() => api.removeRodaBanner(roda.id)}
        />
        {bannerSrc && (
          <BannerEditor
            src={bannerSrc}
            pos={pos}
            onChange={(p) => setPos((cur) => ({ ...cur, ...p }))}
            hint="Arraste para escolher o pedaço que aparece e use o zoom. Vale ao salvar a roda; sem capa, a faixa usa a cor."
            wide
          />
        )}
      </fieldset>
      <fieldset className="field">
        <legend>Quem entra</legend>
        <div className="choice-row">
          <button type="button" className="choice" aria-pressed={privacy === "privada"} onClick={() => setPrivacy("privada")}>
            Privada: só com convite
          </button>
          <button type="button" className="choice" aria-pressed={privacy === "aberta"} onClick={() => setPrivacy("aberta")}>
            Aberta: qualquer um daqui
          </button>
        </div>
      </fieldset>
      <button className="btn btn-primary" disabled={busy}>
        Salvar
      </button>
      <hr />
      <button type="button" className="btn btn-danger" onClick={() => void remove()}>
        Apagar a roda
      </button>
    </form>
  );
}

function RolesTab({ roda }: { roda: Roda }) {
  const [editing, setEditing] = useState<string | "new">(roda.roles[0]?.id ?? "new");
  const role = roda.roles.find((r) => r.id === editing);
  const count = (id: string) => Object.values(roda.members).filter((r) => r === id).length;
  return (
    <div className="roles-layout">
      <ul className="roles-list">
        {roda.roles.map((r) => (
          <li key={r.id}>
            <button type="button" className="role-item" aria-pressed={editing === r.id} onClick={() => setEditing(r.id)}>
              <span className="status-dot" style={{ background: r.color }} aria-hidden="true" />
              <span className="role-item-name">{r.name}</span>
              <span className="mono-label">{count(r.id)}</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="role-item" aria-pressed={editing === "new"} onClick={() => setEditing("new")}>
            + Novo cargo
          </button>
        </li>
      </ul>
      <RoleEditor key={editing} roda={roda} role={role} onCreated={(id) => setEditing(id)} />
    </div>
  );
}

function RoleEditor({ roda, role, onCreated }: { roda: Roda; role: RodaRole | undefined; onCreated(id: string): void }) {
  const [name, setName] = useState(role?.name ?? "");
  const [color, setColor] = useState(role?.color ?? "#b4b4bc");
  const [perms, setPerms] = useState<Permission[]>(role?.perms ?? ["ver", "enviar", "anexar", "voz", "tela"]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const body = { name: name.trim(), color, perms };
    if (role) await run(() => api.updateRole(roda.id, role.id, body), "Cargo salvo.");
    else await run(async () => onCreated((await api.createRole(roda.id, body)).role.id), "Cargo criado.");
  }

  return (
    <form className="form role-editor" onSubmit={save}>
      <div className="role-editor-head">
        <label className="field grow">
          <span>Nome do cargo</span>
          <input value={name} maxLength={24} required onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Cor</span>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="color-input" />
        </label>
      </div>
      {role?.owner ? (
        <p className="callout">O dono pode tudo na roda. Só o nome e a cor mudam.</p>
      ) : (
        <fieldset className="field">
          <legend>O que este cargo pode</legend>
          <div className="perm-list">
            {PERMISSIONS.map((p) => (
              <label key={p} className="check">
                <input type="checkbox" checked={perms.includes(p)} onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))} />
                <span>{PERM_LABELS[p]}</span>
              </label>
            ))}
          </div>
          {role?.isDefault && <small>É o cargo de quem entra na roda.</small>}
        </fieldset>
      )}
      <div className="row-actions">
        <button className="btn btn-primary">{role ? "Salvar cargo" : "Criar cargo"}</button>
        {role && !role.owner && !role.isDefault && (
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => confirm(`Apagar o cargo ${role.name}? Quem tem passa para o cargo de quem entra.`) && void run(() => api.deleteRole(roda.id, role.id), "Cargo apagado.")}
          >
            Apagar cargo
          </button>
        )}
      </div>
    </form>
  );
}

function MembersTab({ roda, canSetRole, canKick }: { roda: Roda; canSetRole: boolean; canKick: boolean }) {
  const users = useApp((s) => s.users);
  const me = useApp((s) => (s.me ? s.me.id : null));
  const members = Object.keys(roda.members)
    .filter((id) => users[id] && !users[id].removed)
    .sort((a, b) => (roleOf(roda, a)?.position ?? 99) - (roleOf(roda, b)?.position ?? 99) || users[a]!.displayName.localeCompare(users[b]!.displayName, "pt-BR"));
  return (
    <ul className="admin-list">
      {members.map((id) => {
        const role = roleOf(roda, id);
        return (
          <li key={id} className="admin-row">
            <Avatar user={users[id]} size={32} />
            <span className="admin-row-main">
              <Nick user={users[id]} />
              <span className="muted">@{users[id]!.username}</span>
            </span>
            {canSetRole && !role?.owner ? (
              <select
                value={role?.id}
                aria-label={`Cargo de ${users[id]!.displayName}`}
                onChange={(e) => void run(() => api.setMemberRole(roda.id, id, e.target.value))}
              >
                {roda.roles.filter((r) => !r.owner).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="mono-label" style={{ color: role?.color }}>
                {role?.name}
              </span>
            )}
            {canSetRole && !role?.owner && (
              <button
                type="button"
                className="btn btn-small btn-ghost"
                onClick={() =>
                  confirm(`Passar a posse de ${roda.name} para ${users[id]!.displayName}? Você fica com o cargo que essa pessoa tem hoje.`) &&
                  void run(() => api.transferOwner(roda.id, id), "Posse passada.")
                }
              >
                Passar a posse
              </button>
            )}
            {canKick && !role?.owner && id !== me && (
              <button
                type="button"
                className="btn btn-small btn-danger"
                onClick={() => confirm(`Tirar ${users[id]!.displayName} da roda?`) && void run(() => api.kickMember(roda.id, id))}
              >
                Tirar
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const EXPIRY = [
  { label: "30 min", minutes: 30 },
  { label: "1 dia", minutes: 60 * 24 },
  { label: "7 dias", minutes: 60 * 24 * 7 },
  { label: "Nunca", minutes: null },
] as const;

function InvitesTab({ roda }: { roda: Roda }) {
  const users = useApp((s) => s.users);
  const [invites, setInvites] = useState<(Invite & { url: string })[]>([]);
  const [expiry, setExpiry] = useState<number | null>(60 * 24 * 7);
  const [maxUses, setMaxUses] = useState(25);
  const [approval, setApproval] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .rodaInvites(roda.id)
      .then((r) => setInvites(r.invites))
      .catch((err) => toast.fromError(err));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roda.id]);

  const copy = (url: string) =>
    navigator.clipboard.writeText(url).then(
      () => toast.info("Link do convite copiado."),
      () => toast.error("Não deu para copiar; selecione o link e copie."),
    );

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await run(async () => {
      const { invite } = await api.createRodaInvite(roda.id, { expiresInMinutes: expiry, maxUses, approval: approval && roda.privacy === "privada" });
      await copy(invite.url);
    });
    setBusy(false);
    if (ok) void load();
  }

  return (
    <div className="form">
      {roda.requests.length > 0 && (
        <section className="field">
          <span className="mono-label">pedidos para entrar</span>
          <ul className="admin-list">
            {roda.requests.map((id) => (
              <li key={id} className="admin-row">
                <Avatar user={users[id]} size={32} />
                <span className="admin-row-main">
                  <Nick user={users[id]} />
                </span>
                <button type="button" className="btn btn-small btn-ghost" onClick={() => void run(() => api.denyRequest(roda.id, id))}>
                  Recusar
                </button>
                <button type="button" className="btn btn-small btn-primary" onClick={() => void run(() => api.approveRequest(roda.id, id))}>
                  Aprovar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form className="form card invite-form-card" onSubmit={create}>
        <fieldset className="field">
          <legend>Vale por</legend>
          <div className="choice-row">
            {EXPIRY.map((x) => (
              <button key={x.label} type="button" className="choice" aria-pressed={expiry === x.minutes} onClick={() => setExpiry(x.minutes)}>
                {x.label}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="field">
          <span>Quantas pessoas podem usar</span>
          <input type="number" min={1} max={100} value={maxUses} onChange={(e) => setMaxUses(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
        </label>
        {roda.privacy === "privada" && (
          <label className="check">
            <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} />
            <span>
              Pedir aprovação
              <small>Quem usar o link vira um pedido; alguém com permissão de convidar aprova.</small>
            </span>
          </label>
        )}
        <button className="btn btn-primary" disabled={busy}>
          Criar convite e copiar o link
        </button>
      </form>

      {invites.length > 0 && (
        <section className="field">
          <span className="mono-label">convites ativos</span>
          <ul className="admin-list">
            {invites.map((i) => (
              <li key={i.code} className="admin-row">
                <span className="admin-row-main">
                  <code className="invite-code">{i.url.replace(/^https?:\/\//, "")}</code>
                  <span className="muted small-note">
                    {i.uses}/{i.maxUses} usos ·{" "}
                    {i.expiresAt ? `até ${new Date(i.expiresAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : "não expira"}
                    {i.approval ? " · com aprovação" : ""}
                  </span>
                </span>
                <button type="button" className="icon-btn" aria-label="Copiar link" title="Copiar link" onClick={() => void copy(i.url)}>
                  <Copy size={16} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  data-danger
                  aria-label="Cancelar convite"
                  title="Cancelar convite"
                  onClick={() => void run(() => api.revokeRodaInvite(roda.id, i.code)).then((ok) => { if (ok) void load(); })}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RoomsTab({ roda }: { roda: Roda }) {
  const all = useApp((s) => s.channels).filter((c) => c.rodaId === roda.id);
  // texto primeiro, depois voz, como na lateral; as setinhas só trocam dentro do mesmo grupo
  const channels = [...all.filter((c) => c.kind === "text"), ...all.filter((c) => c.kind === "voice")];
  return (
    <div className="form">
      <ul className="admin-list">
        {channels.map((c, i) => {
          const prev = channels[i - 1]?.kind === c.kind ? channels[i - 1] : undefined;
          const next = channels[i + 1]?.kind === c.kind ? channels[i + 1] : undefined;
          return (
            <li key={c.id} className="admin-row">
              <span className="channel-hash" aria-hidden="true">
                {c.kind === "text" ? "#" : "♪"}
              </span>
              <RoomName id={c.id} name={c.name} />
              <button
                type="button"
                className="icon-btn"
                disabled={!prev}
                aria-label={`Subir ${c.name}`}
                title="Subir"
                onClick={() => prev && void moveRoom(roda.id, c.id, prev.id, false)}
              >
                <ChevronUp size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={!next}
                aria-label={`Descer ${c.name}`}
                title="Descer"
                onClick={() => next && void moveRoom(roda.id, c.id, next.id, true)}
              >
                <ChevronDown size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                data-danger
                aria-label={`Apagar ${c.name}`}
                title="Apagar sala"
                onClick={() => confirm(`Apagar ${c.name} com todas as mensagens?`) && void run(() => api.deleteChannel(c.id), "Sala apagada.")}
              >
                <Trash2 size={16} />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="row-actions">
        <button type="button" className="btn btn-outline" onClick={() => useUi.getState().setNewRoom({ rodaId: roda.id, kind: "text" })}>
          + Sala de texto
        </button>
        <button type="button" className="btn btn-outline" onClick={() => useUi.getState().setNewRoom({ rodaId: roda.id, kind: "voice" })}>
          + Sala de voz
        </button>
      </div>
    </div>
  );
}

/** Nome da sala editável no lugar: salva ao sair do campo ou com Enter. */
function RoomName({ id, name }: { id: string; name: string }) {
  const [value, setValue] = useState(name);
  const save = () => {
    const next = value.trim();
    if (next && next !== name) void run(() => api.updateChannel(id, { name: next }));
    else setValue(name);
  };
  return (
    <input
      className="room-name-input"
      value={value}
      maxLength={LIMITS.channelNameMax}
      aria-label="Nome da sala"
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
