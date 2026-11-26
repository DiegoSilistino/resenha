import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { LIMITS, type Me } from "@resenha/shared";
import { api, ApiError } from "../lib/api.ts";
import { useApp } from "../state/app.ts";

/** Criar conta: aberto a todos; com `code` (link de convite), a conta já entra na roda do convite. */
export function SignupForm({ code }: { code?: string }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", displayName: "", password: "", confirm: "", email: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  /** Conta criada com e-mail: falta confirmar o código (ou pular) antes de entrar. */
  const [pending, setPending] = useState<Me | null>(null);
  const [emailCode, setEmailCode] = useState("");

  function enter(user: Me) {
    useApp.getState().setMe(user);
    navigate("/", { replace: true });
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setBusy(true);
    setErrors({});
    try {
      await api.confirmEmail(emailCode.trim());
      enter(pending);
    } catch (err) {
      setErrors(err instanceof ApiError ? { ...err.fields, _: err.message } : { _: "Não foi possível confirmar" });
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <form onSubmit={confirm} className="form">
        <p className="muted small-note">
          Conta criada! Mandamos um código para {form.email.trim()} (olhe também o spam). Com o e-mail confirmado, dá para
          recuperar a senha se você esquecer.
        </p>
        <Field label="Código" error={errors.code}>
          <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={emailCode} onChange={(e) => setEmailCode(e.target.value)} required />
        </Field>
        {errors._ && !errors.code && (
          <p className="form-error" role="alert">
            {errors._}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Confirmando…" : "Confirmar e entrar"}
        </button>
        <button type="button" className="link-btn" onClick={() => enter(pending)}>
          Pular (dá para confirmar depois em Configurações → Conta)
        </button>
      </form>
    );
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setErrors({ confirm: "As senhas não são iguais" });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const email = form.email.trim();
      const { me: user, emailPending } = await api.register({
        ...(code ? { code } : {}),
        username: form.username,
        displayName: form.displayName,
        password: form.password,
        ...(email ? { email } : {}),
      });
      if (emailPending) {
        setPending(user);
        setBusy(false);
      } else {
        enter(user);
      }
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fields, _: err.message });
      else setErrors({ _: "Não foi possível criar a conta" });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form" noValidate>
      <Field label="Seu nome" hint="Como a turma vai te ver" error={errors.displayName}>
        <input autoFocus maxLength={LIMITS.displayNameMax} value={form.displayName} onChange={set("displayName")} required />
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
      <Field label="E-mail (opcional)" hint="Para recuperar a senha se você esquecer. Chega um código para confirmar." error={errors.email}>
        <input type="email" autoComplete="email" maxLength={LIMITS.emailMax} value={form.email} onChange={set("email")} />
      </Field>
      <p className="small-note muted">
        Ao criar a conta, você concorda com os <Link to="/termos">termos de uso e a política de privacidade</Link>.
      </p>
      {errors._ && !Object.keys(errors).some((k) => k !== "_") && (
        <p className="form-error" role="alert">
          {errors._}
        </p>
      )}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "Criando conta…" : "Criar conta e entrar"}
      </button>
    </form>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | undefined; children: React.ReactElement }) {
  return (
    <label className="field" data-invalid={error ? true : undefined}>
      <span>{label}</span>
      {children}
      {error ? <small className="field-error">{error}</small> : hint ? <small>{hint}</small> : null}
    </label>
  );
}
