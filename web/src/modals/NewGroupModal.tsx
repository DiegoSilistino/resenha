import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { LIMITS } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { Modal } from "../components/Modal.tsx";
import { Nick } from "../components/Nick.tsx";
import { openConversationWith } from "../lib/social.ts";
import { useApp } from "../state/app.ts";
import { useUi } from "../state/ui.ts";

/** Grupo privado: nome e amigos (até 10 pessoas contando você). */
export function NewGroupModal() {
  const friends = useApp((s) => s.friends);
  const users = useApp((s) => s.users);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const close = () => useUi.getState().setNewGroupOpen(false);
  const max = LIMITS.groupMax - 1;
  const list = Object.values(friends)
    .filter((f) => f.status === "friend" && users[f.userId])
    .map((f) => users[f.userId]!)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const created = await openConversationWith(picked, navigate, name.trim() || "Grupo");
    setBusy(false);
    if (created) close();
  }

  return (
    <Modal title="Novo grupo" onClose={close}>
      <form className="form" onSubmit={submit}>
        <p className="muted small-note">Conversa privada de até {LIMITS.groupMax} pessoas, contando você.</p>
        <label className="field">
          <span>Nome do grupo</span>
          <input value={name} maxLength={LIMITS.channelNameMax} placeholder="ex.: Ranked de sexta" onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="field">
          <legend>
            Quem entra ({picked.length}/{max})
          </legend>
          {list.length === 0 ? (
            <p className="muted small-note">Você ainda não tem amigos para chamar. Adicione alguém em Amigos.</p>
          ) : (
            <ul className="pick-list">
              {list.map((u) => {
                const on = picked.includes(u.id);
                return (
                  <li key={u.id}>
                    <label className="pick-row">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!on && picked.length >= max}
                        onChange={() => setPicked(on ? picked.filter((id) => id !== u.id) : [...picked, u.id])}
                      />
                      <Avatar user={u} size={30} />
                      <Nick user={u} />
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>
        <button className="btn btn-primary" disabled={busy || picked.length === 0}>
          Criar grupo
        </button>
      </form>
    </Modal>
  );
}
