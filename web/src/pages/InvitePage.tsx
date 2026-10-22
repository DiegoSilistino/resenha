import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { APP_NAME, LIMITS, type Role } from "@resenha/shared";
import { api, ApiError } from "../lib/api.ts";
import { logout } from "../lib/session.ts";
import { useApp } from "../state/app.ts";

export function InvitePage() {
  const { code = "" } = useParams();
  const me = useApp((s) => s.me);
  const navigate = useNavigate();
  const [role, setRole] = useState<Role | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [form, setForm] = useState({ username: "", displayName: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .inviteInfo(code)
      .then((r) => setRole(r.role))
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

  let body;
  if (me) {
    body = (
      <>
        <p className="auth-lede">
          Você já está conectado como <strong>{me.displayName}</strong>. Para criar outra conta com este convite, saia
          primeiro.
        </p>
        <div className="row-actions">
          <button className="btn" onClick={() => navigate("/")}>
            Voltar para o app
          </button>
          <button className="btn btn-primary" onClick={() => void logout()}>
            Sair e usar o convite
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
  } else if (!role) {
    body = <p className="auth-lede">Verificando convite…</p>;
  } else {
    body = (
      <>
        <p className="auth-lede">
          {role === "admin"
            ? "Você vai criar a conta de administração do grupo."
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
