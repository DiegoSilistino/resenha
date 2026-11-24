import { useRef, useState } from "react";
import { Copy, Search } from "lucide-react";
import { Avatar } from "../components/Avatar.tsx";
import { Modal } from "../components/Modal.tsx";
import { api } from "../lib/api.ts";
import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";
import { useUi } from "../state/ui.ts";

/**
 * "Convidar para a roda", como no Discord: um clique manda o link no privado do amigo
 * (sem sair daqui), ou copia o link para mandar onde quiser.
 */
export function InviteFriendsDialog() {
  const rodaId = useUi((s) => s.inviteRodaId)!;
  const roda = useApp((s) => s.rodas[rodaId]);
  const friends = useApp((s) => s.friends);
  const users = useApp((s) => s.users);
  const [query, setQuery] = useState("");
  const [sent, setSent] = useState<Record<string, "enviando" | "enviado">>({});
  const [url, setUrl] = useState<string | null>(null);
  const pending = useRef<Promise<string> | null>(null);
  const close = () => useUi.getState().setInviteRoda(null);
  if (!roda) return null;

  // Um link só para a janela inteira (7 dias, até 25 pessoas), criado na primeira vez que precisar.
  const link = () =>
    (pending.current ??= api
      .createRodaInvite(roda.id, { expiresInMinutes: 60 * 24 * 7, maxUses: 25, approval: false })
      .then(({ invite }) => {
        setUrl(invite.url);
        return invite.url;
      })
      .catch((err: unknown) => {
        pending.current = null; // deixa tentar de novo
        throw err;
      }));

  async function invite(userId: string) {
    setSent((s) => ({ ...s, [userId]: "enviando" }));
    try {
      const inviteUrl = await link();
      const { conversation } = await api.openConversation([userId]);
      useApp.getState().applyEvent({ type: "conversation.upsert", conversation });
      await api.sendMessage(conversation.id, `Bora entrar na roda ${roda!.name}? ${inviteUrl}`, []);
      setSent((s) => ({ ...s, [userId]: "enviado" }));
    } catch (err) {
      toast.fromError(err);
      setSent(({ [userId]: _, ...rest }) => rest);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(await link());
      toast.info("Link do convite copiado.");
    } catch (err) {
      toast.fromError(err, "Não deu para copiar; tente de novo");
    }
  }

  const q = query.trim().toLocaleLowerCase("pt-BR");
  const candidates = Object.values(friends)
    .filter((f) => f.status === "friend" && !(f.userId in roda.members))
    .map((f) => users[f.userId])
    .filter((u) => !!u && !u.removed)
    .filter((u) => !q || u!.displayName.toLocaleLowerCase("pt-BR").includes(q) || u!.username.includes(q))
    .sort((a, b) => a!.displayName.localeCompare(b!.displayName, "pt-BR"));

  return (
    <Modal title={`Convidar para ${roda.name}`} onClose={close}>
      <div className="form">
        <label className="invite-search">
          <Search size={16} aria-hidden="true" />
          <input autoFocus placeholder="Buscar amigos" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar amigos" />
        </label>
        {candidates.length > 0 ? (
          <ul className="admin-list invite-friends">
            {candidates.map((u) => {
              const state = sent[u!.id];
              return (
                <li key={u!.id} className="admin-row">
                  <Avatar user={u} size={32} />
                  <span className="admin-row-main">
                    <strong>{u!.displayName}</strong>
                    <span className="muted small-note">@{u!.username}</span>
                  </span>
                  <button
                    type="button"
                    className={state === "enviado" ? "btn btn-small btn-ghost" : "btn btn-small btn-primary"}
                    disabled={!!state}
                    onClick={() => void invite(u!.id)}
                  >
                    {state === "enviado" ? "Enviado" : state === "enviando" ? "Enviando…" : "Convidar"}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">
            {q ? "Nenhum amigo com esse nome." : "Nenhum amigo para convidar: todos já estão aqui, ou ainda não há amigos adicionados."}
          </p>
        )}
        <section className="field">
          <span className="mono-label">ou mande o link</span>
          <div className="invite-link-row">
            <code className="invite-code">{url ? url.replace(/^https?:\/\//, "") : "O link aparece aqui ao copiar ou convidar"}</code>
            <button type="button" className="btn btn-small btn-outline" onClick={() => void copy()}>
              <Copy size={14} aria-hidden="true" /> Copiar
            </button>
          </div>
          <small className="muted">Vale por 7 dias, para até 25 pessoas. Os outros tipos de convite ficam em Ajustes → Convites.</small>
        </section>
      </div>
    </Modal>
  );
}
