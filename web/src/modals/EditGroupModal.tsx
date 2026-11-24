import { useState, type FormEvent } from "react";
import { LIMITS } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { Modal } from "../components/Modal.tsx";
import { Nick } from "../components/Nick.tsx";
import { api } from "../lib/api.ts";
import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";

/** Grupo já criado: trocar o nome e chamar mais amigos (até 10 pessoas no total). */
export function EditGroupModal({ id, onClose }: { id: string; onClose(): void }) {
  const conv = useApp((s) => s.conversations[id]);
  const friends = useApp((s) => s.friends);
  const users = useApp((s) => s.users);
  const [name, setName] = useState(conv?.name ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  if (!conv) return null;

  const room = LIMITS.groupMax - conv.memberIds.length;
  const candidates = Object.values(friends)
    .filter((f) => f.status === "friend" && users[f.userId] && !conv.memberIds.includes(f.userId))
    .map((f) => users[f.userId]!)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (name.trim() && name.trim() !== conv!.name) await api.renameConversation(id, name.trim());
      if (picked.length) await api.addConversationMembers(id, picked);
      onClose();
    } catch (err) {
      toast.fromError(err);
      setBusy(false);
    }
  }

  return (
    <Modal title="Editar grupo" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <label className="field">
          <span>Nome do grupo</span>
          <input value={name} maxLength={LIMITS.channelNameMax} required onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="field">
          <legend>No grupo ({conv.memberIds.length}/{LIMITS.groupMax})</legend>
          <ul className="pick-list">
            {conv.memberIds.map((uid) => (
              <li key={uid} className="pick-row">
                <Avatar user={users[uid]} size={30} />
                <Nick user={users[uid]} />
              </li>
            ))}
          </ul>
        </fieldset>
        {candidates.length > 0 && room > 0 && (
          <fieldset className="field">
            <legend>Chamar mais amigos ({picked.length}/{room})</legend>
            <ul className="pick-list">
              {candidates.map((u) => {
                const on = picked.includes(u.id);
                return (
                  <li key={u.id}>
                    <label className="pick-row">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!on && picked.length >= room}
                        onChange={() => setPicked(on ? picked.filter((x) => x !== u.id) : [...picked, u.id])}
                      />
                      <Avatar user={u} size={30} />
                      <Nick user={u} />
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}
        <button className="btn btn-primary" disabled={busy || !name.trim()}>
          Salvar
        </button>
      </form>
    </Modal>
  );
}
