import { useState, type FormEvent } from "react";
import { LIMITS } from "@resenha/shared";
import { api } from "../lib/api.ts";
import { toast } from "../state/toasts.ts";
import { Modal } from "./Modal.tsx";

/** Denunciar uma mensagem (com `messageId`) ou uma pessoa: vai para a aba Denúncias do painel do admin. */
export function ReportDialog({
  userId,
  name,
  messageId,
  preview,
  onClose,
}: {
  userId: string;
  name: string;
  messageId?: number;
  preview?: string;
  onClose(): void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.report({ userId, reason: reason.trim(), ...(messageId ? { messageId } : {}) });
      toast.info("Denúncia enviada. Os administradores vão olhar.");
      onClose();
    } catch (err) {
      toast.fromError(err, "Não foi possível enviar a denúncia");
      setBusy(false);
    }
  }

  return (
    <Modal title={messageId ? "Denunciar mensagem" : `Denunciar ${name}`} onClose={onClose}>
      <form className="form" onSubmit={send}>
        {preview && <blockquote className="report-preview">{preview}</blockquote>}
        <label className="field">
          <span>O que aconteceu? (opcional)</span>
          <textarea rows={3} maxLength={LIMITS.reportReasonMax} value={reason} onChange={(e) => setReason(e.target.value)} />
          <small>
            Os administradores do site veem a denúncia{messageId ? " e o texto da mensagem" : ""}. {name} não fica sabendo quem
            denunciou.
          </small>
        </label>
        <div className="row-actions">
          <button className="btn btn-danger" disabled={busy}>
            {busy ? "Enviando…" : "Enviar denúncia"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}
