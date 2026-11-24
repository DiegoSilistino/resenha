import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { LIMITS, type Roda } from "@resenha/shared";
import { Modal } from "../components/Modal.tsx";
import { api } from "../lib/api.ts";
import { waitForRoda } from "../lib/rodas.ts";
import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";
import { useUi } from "../state/ui.ts";

const TEMPLATES = [
  { id: "amigos", label: "Amigos", hint: "#geral, #clipes e uma sala de voz" },
  { id: "estudos", label: "Estudos", hint: "#avisos, #dúvidas e duas salas de estudo" },
  { id: "jogos", label: "Jogos", hint: "#geral, #clipes, Ranked e Casual" },
] as const;

/** Nova roda: nome, descrição, privacidade e um modelo de salas para começar. */
export function NewRodaModal() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState<Roda["privacy"]>("privada");
  const [template, setTemplate] = useState<(typeof TEMPLATES)[number]["id"]>("amigos");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const close = () => useUi.getState().setNewRodaOpen(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { roda } = await api.createRoda({ name: name.trim(), description: description.trim(), privacy, template });
      await waitForRoda(roda.id);
      close();
      void navigate(`/r/${roda.id}`);
    } catch (err) {
      toast.fromError(err);
      setBusy(false);
    }
  }

  return (
    <Modal title="Nova roda" onClose={close}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Nome</span>
          <input value={name} maxLength={LIMITS.rodaNameMax} required placeholder="ex.: Turma do RPG" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Descrição</span>
          <input value={description} maxLength={LIMITS.noteMax} placeholder="uma frase sobre a roda (opcional)" onChange={(e) => setDescription(e.target.value)} />
        </label>
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
        <fieldset className="field">
          <legend>Começar com</legend>
          <div className="template-grid">
            {TEMPLATES.map((t) => (
              <button key={t.id} type="button" className="template" aria-pressed={template === t.id} onClick={() => setTemplate(t.id)}>
                <strong>{t.label}</strong>
                <small>{t.hint}</small>
              </button>
            ))}
          </div>
        </fieldset>
        <button className="btn btn-primary" disabled={busy || !name.trim()}>
          Criar roda
        </button>
      </form>
    </Modal>
  );
}

/** Sala nova numa roda (quem tem a permissão "salas"). */
export function NewRoomModal() {
  const room = useUi((s) => s.newRoom)!;
  const roda = useApp((s) => s.rodas[room.rodaId]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState(room.kind);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const close = () => useUi.getState().setNewRoom(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { channel } = await api.createRoom(room.rodaId, name.trim(), kind);
      useApp.getState().applyEvent({ type: "channel.upsert", channel });
      close();
      void navigate(`/c/${channel.id}`);
    } catch (err) {
      toast.fromError(err);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Nova sala${roda ? ` em ${roda.name}` : ""}`} onClose={close}>
      <form className="form" onSubmit={submit}>
        <fieldset className="field">
          <legend>Tipo</legend>
          <div className="choice-row">
            <button type="button" className="choice" aria-pressed={kind === "text"} onClick={() => setKind("text")}>
              # Texto
            </button>
            <button type="button" className="choice" aria-pressed={kind === "voice"} onClick={() => setKind("voice")}>
              Voz
            </button>
          </div>
        </fieldset>
        <label className="field">
          <span>Nome</span>
          <input
            value={name}
            maxLength={LIMITS.channelNameMax}
            required
            autoFocus
            placeholder={kind === "text" ? "ex.: memes" : "ex.: Jogatina"}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="btn btn-primary" disabled={busy || !name.trim()}>
          Criar sala
        </button>
      </form>
    </Modal>
  );
}
