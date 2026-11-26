import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { APP_NAME, type InviteInfo } from "@resenha/shared";
import rindo from "../assets/mascote/rindo.webp";
import surpreso from "../assets/mascote/surpreso.webp";
import { api, ApiError } from "../lib/api.ts";
import { waitForRoda } from "../lib/rodas.ts";
import { logout } from "../lib/session.ts";
import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";
import { SignupForm } from "./SignupForm.tsx";

export function InvitePage() {
  const { code = "" } = useParams();
  const me = useApp((s) => s.me);
  const navigate = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [requested, setRequested] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .inviteInfo(code)
      .then(setInfo)
      .catch((err) => setInvalid(err instanceof ApiError ? err.message : "Convite inválido"));
  }, [code]);

  // Já tem conta: entra na roda do convite (ou manda o pedido, se precisa de aprovação).
  async function join() {
    setBusy(true);
    try {
      const r = await api.joinInvite(code);
      if (r.status === "requested") {
        setRequested(true);
        setBusy(false);
        return;
      }
      await waitForRoda(r.rodaId);
      navigate(`/r/${r.rodaId}`, { replace: true });
    } catch (err) {
      toast.fromError(err);
      setBusy(false);
    }
  }

  const rodaName = info?.roda?.name;
  let body;
  if (me && invalid) {
    body = (
      <>
        <p className="auth-lede" role="alert">
          {invalid}. Peça um link novo para quem te convidou.
        </p>
        <button className="btn" onClick={() => navigate("/")}>
          Voltar para o app
        </button>
      </>
    );
  } else if (me && requested) {
    body = (
      <>
        <p className="auth-lede">
          Pedido enviado. Quando alguém de <strong>{rodaName}</strong> aprovar, a roda aparece para você.
        </p>
        <button className="btn" onClick={() => navigate("/")}>
          Voltar para o app
        </button>
      </>
    );
  } else if (me) {
    body = (
      <>
        <p className="auth-lede">
          {rodaName ? (
            <>
              Você foi chamado para <strong>{rodaName}</strong>
              {info?.roda ? ` (${info.roda.memberCount} ${info.roda.memberCount === 1 ? "membro" : "membros"})` : ""}.
            </>
          ) : (
            "Verificando convite…"
          )}
        </p>
        <div className="row-actions">
          <button className="btn btn-primary" disabled={busy || !info} onClick={() => void join()}>
            {info?.roda?.approval ? "Pedir para entrar" : "Entrar na roda"}
          </button>
          <button className="btn btn-ghost" onClick={() => void logout()}>
            Usar com outra conta
          </button>
        </div>
      </>
    );
  } else if (invalid) {
    // o convite não vale mais, mas o cadastro é aberto: dá para criar a conta mesmo assim
    body = (
      <>
        <p className="auth-lede" role="alert">
          {invalid}. Você ainda pode criar sua conta e pedir um link novo para entrar na roda.
        </p>
        <SignupForm />
      </>
    );
  } else if (!info) {
    body = <p className="auth-lede">Verificando convite…</p>;
  } else {
    body = (
      <>
        <p className="auth-lede">
          {info.role === "admin"
            ? "Você vai criar a conta de administração."
            : rodaName
              ? <>Você foi chamado para <strong>{rodaName}</strong>. Crie sua conta para entrar.</>
              : "Você foi convidado. Crie sua conta para entrar."}
        </p>
        <SignupForm code={code} />
      </>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <img className="auth-mascot" src={invalid ? surpreso : rindo} alt="" width={invalid ? 408 : 464} height={480} decoding="async" />
        <h1 className="wordmark wordmark-lg">{APP_NAME}</h1>
        {body}
      </section>
    </main>
  );
}
