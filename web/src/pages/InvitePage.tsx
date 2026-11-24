import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { APP_NAME, LIMITS, type InviteInfo } from "@resenha/shared";
import { api, ApiError } from "../lib/api.ts";
import { waitForRoda } from "../lib/rodas.ts";
import { logout } from "../lib/session.ts";
import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";

export function InvitePage() {
  const { code = "" } = useParams();
  const me = useApp((s) => s.me);
  const navigate = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [requested, setRequested] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [form, setForm] = useState({ username: "", displayName: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .inviteInfo(code)
      .then(setInfo)
      .catch((err) => setInvalid(err instanceof ApiError ? err.message : "Convite inválido"));
  }, [code]);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setErrors({ confirm: "As senhas não são iguais" });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const { me: user } = await api.register({
        code,
        username: form.username,
        displayName: form.displayName,
        password: form.password,
      });
      useApp.getState().setMe(user);
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fields, _: err.message });
      else setErrors({ _: "Não foi possível criar a conta" });
      setBusy(false);
    }
  }

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
    body = (
      <p className="auth-lede" role="alert">
        {invalid}. Peça um link novo para quem te convidou.
      </p>
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
        <form onSubmit={submit} className="form" noValidate>
          <Field label="Seu nome" hint="Como a turma vai te ver" error={errors.displayName}>
            <input
              autoFocus
              maxLength={LIMITS.displayNameMax}
              value={form.displayName}
              onChange={set("displayName")}
              required
            />
          </Field>
          <Field label="Usuário" hint="Para entrar. Letras minúsculas, números, . _ -" error={errors.username}>
            <input
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={LIMITS.usernameMax}
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.toLowerCase() }))}
              required
            />
          </Field>
          <Field label="Senha" hint={`Pelo menos ${LIMITS.passwordMin} caracteres`} error={errors.password}>
            <input type="password" autoComplete="new-password" value={form.password} onChange={set("password")} required />
          </Field>
          <Field label="Repita a senha" error={errors.confirm}>
            <input type="password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} required />
          </Field>
          {errors._ && !Object.keys(errors).some((k) => k !== "_") && (
            <p className="form-error" role="alert">
              {errors._}
            </p>
          )}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Criando conta…" : "Criar conta e entrar"}
          </button>
        </form>
      </>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1 className="wordmark wordmark-lg">{APP_NAME}</h1>
        {body}
      </section>
    </main>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  children: React.ReactElement;
}) {
  return (
    <label className="field" data-invalid={error ? true : undefined}>
      <span>{label}</span>
      {children}
      {error ? <small className="field-error">{error}</small> : hint ? <small>{hint}</small> : null}
    </label>
  );
}
