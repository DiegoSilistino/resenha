import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { InviteInfo } from "@resenha/shared";
import { RodaBadge } from "../layout/Sidebar.tsx";
import { api } from "../lib/api.ts";
import { waitForRoda } from "../lib/rodas.ts";
import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";

// Cada convite é consultado uma vez por sessão: a rota pública tem limite de pedidos.
const cache = new Map<string, Promise<InviteInfo | null>>();
const infoOf = (code: string) => {
  let p = cache.get(code);
  if (!p) {
    p = api.inviteInfo(code).catch(() => null);
    cache.set(code, p);
  }
  return p;
};

/** Cartão de convite no chat, como no Discord: nome e foto da roda e o botão de entrar. */
export function InviteCard({ code }: { code: string }) {
  const navigate = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const roda = info?.roda;
  const member = useApp((s) => !!roda && !!s.rodas[roda.id]);

  useEffect(() => {
    let live = true;
    void infoOf(code).then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [code]);

  async function join() {
    setBusy(true);
    try {
      const r = await api.joinInvite(code);
      if (r.status === "requested") {
        toast.info("Pedido enviado. Quando alguém aprovar, a roda aparece para você.");
        return;
      }
      await waitForRoda(r.rodaId);
      void navigate(`/r/${r.rodaId}`);
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  }

  if (info === undefined) return null;
  if (!roda) {
    return (
      <div className="invite-card" data-dead>
        <span className="mono-label">convite para uma roda</span>
        <span className="muted">Esse convite expirou ou já foi usado.</span>
      </div>
    );
  }
  return (
    <div className="invite-card">
      <span className="mono-label">convite para uma roda</span>
      <div className="invite-card-row">
        <RodaBadge roda={roda} size={44} />
        <span className="invite-card-text">
          <strong>{roda.name}</strong>
          <span className="muted">
            {roda.memberCount} {roda.memberCount === 1 ? "membro" : "membros"}
          </span>
        </span>
        {member ? (
          <button type="button" className="btn btn-small btn-outline" onClick={() => void navigate(`/r/${roda.id}`)}>
            Abrir
          </button>
        ) : (
          <button type="button" className="btn btn-small btn-primary" disabled={busy} onClick={() => void join()}>
            {roda.approval ? "Pedir para entrar" : "Entrar"}
          </button>
        )}
      </div>
    </div>
  );
}
