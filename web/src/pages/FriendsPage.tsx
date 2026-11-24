import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { FriendEntry, PublicUser } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { Nick } from "../components/Nick.tsx";
import { api, ApiError } from "../lib/api.ts";
import { shownStatus, statusLine } from "../lib/look.ts";
import { callFriend, openConversationWith } from "../lib/social.ts";
import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";
import { useUi } from "../state/ui.ts";

const TABS = [
  { id: "online", label: "Online" },
  { id: "todos", label: "Todos" },
  { id: "pedidos", label: "Pedidos" },
  { id: "adicionar", label: "Adicionar" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** Amigos: quem está online, todos, pedidos de amizade e como chamar alguém. */
export function FriendsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get("aba"))?.id ?? "online") as Tab;
  const friends = useApp((s) => s.friends);
  const incoming = Object.values(friends).filter((f) => f.status === "incoming").length;

  useEffect(() => {
    useUi.getState().setPageTitle("Amigos");
  }, []);

  return (
    <main className="page">
      <div className="page-inner page-inner-tight">
        <header className="friends-head">
          <h1 className="hero-title friends-title">Amigos</h1>
          <nav className="pill-tabs" aria-label="Amigos">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className="pill-tab"
                aria-pressed={tab === t.id}
                onClick={() => setParams(t.id === "online" ? {} : { aba: t.id }, { replace: true })}
              >
                {t.label}
                {t.id === "pedidos" && incoming > 0 && <span className="tab-badge">{incoming}</span>}
              </button>
            ))}
          </nav>
        </header>
        {(tab === "online" || tab === "todos") && <FriendList onlyOnline={tab === "online"} />}
        {tab === "pedidos" && <Requests />}
        {tab === "adicionar" && <AddFriend />}
      </div>
    </main>
  );
}

function FriendList({ onlyOnline }: { onlyOnline: boolean }) {
  const friends = useApp((s) => s.friends);
  const users = useApp((s) => s.users);
  const online = useApp((s) => s.online);
  const navigate = useNavigate();
  const list = Object.values(friends)
    .filter((f) => f.status === "friend" && users[f.userId])
    .map((f) => users[f.userId]!)
    .filter((u) => !onlyOnline || online[u.id])
    .sort((a, b) => Number(!!online[b.id]) - Number(!!online[a.id]) || a.displayName.localeCompare(b.displayName, "pt-BR"));

  if (list.length === 0) {
    return (
      <p className="empty-card">
        {onlyOnline ? "Nenhum amigo online agora." : "Você ainda não tem amigos por aqui. Chame alguém em Adicionar."}
      </p>
    );
  }
  return (
    <section className="page-section">
      <span className="mono-label">
        {onlyOnline ? `${list.length} online agora` : `${list.length} ${list.length === 1 ? "amigo" : "amigos"}`}
      </span>
      <ul className="online-grid friend-grid">
        {list.map((u) => (
          <li key={u.id} className="person-card">
            <button type="button" className="person-open" onClick={() => useUi.getState().openProfile(u.id)}>
              <Avatar user={u} size={44} online={!!online[u.id]} />
              <span className="person-names">
                <Nick user={u} className="person-name" />
                <span className="person-sub">{statusLine(u, shownStatus(u, !!online[u.id], false))}</span>
              </span>
            </button>
            <span className="person-actions">
              <button type="button" className="btn btn-small btn-primary" onClick={() => void openConversationWith([u.id], navigate)}>
                Mensagem
              </button>
              <button type="button" className="btn btn-small btn-outline" onClick={() => void callFriend(u.id, navigate)}>
                Ligar
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Requests() {
  const friends = useApp((s) => s.friends);
  const users = useApp((s) => s.users);
  const incoming = Object.values(friends).filter((f) => f.status === "incoming");
  const outgoing = Object.values(friends).filter((f) => f.status === "outgoing");
  if (incoming.length + outgoing.length === 0) return <p className="empty-card">Nenhum pedido por aqui.</p>;
  return (
    <>
      {incoming.length > 0 && (
        <RequestGroup title="querem ser seus amigos" items={incoming} users={users} />
      )}
      {outgoing.length > 0 && <RequestGroup title="você chamou" items={outgoing} users={users} />}
    </>
  );
}

function RequestGroup({ title, items, users }: { title: string; items: FriendEntry[]; users: Record<string, PublicUser> }) {
  return (
    <section className="page-section">
      <span className="mono-label">{title}</span>
      <ul className="room-list card">
        {items.map((f) => (
          <li key={f.userId} className="request-row">
            <button type="button" className="person-open" onClick={() => useUi.getState().openProfile(f.userId)}>
              <Avatar user={users[f.userId]} size={40} />
              <span className="person-names">
                <Nick user={users[f.userId]} className="person-name" />
                <span className="person-sub">@{users[f.userId]?.username}</span>
              </span>
            </button>
            <FriendRequestActions entry={f} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Aceitar/recusar (pedido que chegou) ou cancelar (pedido que você mandou). */
export function FriendRequestActions({ entry }: { entry: FriendEntry }) {
  const [busy, setBusy] = useState(false);
  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    try {
      await task();
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  }
  if (entry.status === "incoming") {
    return (
      <span className="person-actions">
        <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => void run(() => api.removeFriend(entry.userId))}>
          Recusar
        </button>
        <button type="button" className="btn btn-small btn-primary" disabled={busy} onClick={() => void run(() => api.acceptFriend(entry.userId))}>
          Aceitar
        </button>
      </span>
    );
  }
  return (
    <span className="person-actions">
      <span className="mono-label">esperando resposta</span>
      <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => void run(() => api.removeFriend(entry.userId))}>
        Cancelar
      </button>
    </span>
  );
}

function AddFriend() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    api
      .friendLink()
      .then(({ code }) => setLink(`${location.origin}/amigo/${code}`))
      .catch(() => setLink(null));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { friend } = await api.addFriend(name.trim());
      setResult({ ok: true, text: friend.status === "friend" ? "Vocês agora são amigos!" : "Pedido enviado." });
      setName("");
    } catch (err) {
      setResult({ ok: false, text: err instanceof ApiError ? err.message : "Não deu para enviar o pedido." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="add-friend">
      <form className="card add-friend-card" onSubmit={submit}>
        <h2 className="card-title">Chamar alguém</h2>
        <p className="muted small-note">Digite o usuário da pessoa (o que aparece depois do @ no perfil).</p>
        <div className="add-friend-row">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setResult(null);
            }}
            placeholder="usuario"
            aria-label="Usuário da pessoa"
            autoCapitalize="none"
            autoComplete="off"
          />
          <button className="btn btn-primary" disabled={busy || !name.trim()}>
            Enviar pedido
          </button>
        </div>
        {result && (
          <p className="add-friend-result" data-ok={result.ok || undefined} role="status">
            {result.text}
          </p>
        )}
      </form>
      <div className="card add-friend-card">
        <h2 className="card-title">Ou mande seu link de amizade</h2>
        <p className="muted small-note">Quem abrir já cai no pedido, sem digitar nada.</p>
        <div className="add-friend-row">
          <input value={link ?? "…"} readOnly aria-label="Seu link de amizade" onFocus={(e) => e.currentTarget.select()} />
          <button
            type="button"
            className="btn btn-outline"
            disabled={!link}
            onClick={() => {
              if (!link) return;
              void navigator.clipboard.writeText(link).then(
                () => toast.info("Link copiado."),
                () => toast.error("Não deu para copiar; selecione o link e copie."),
              );
            }}
          >
            Copiar
          </button>
        </div>
      </div>
    </div>
  );
}
