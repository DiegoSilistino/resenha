import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { APP_NAME, LIMITS } from "@resenha/shared";
import rindo from "../assets/mascote/rindo.webp";
import { api, ApiError } from "../lib/api.ts";
import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";
import { SignupForm } from "./SignupForm.tsx";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  /** Senha certa de quem tem verificação em duas etapas: falta o código do app. */
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(username, password);
      if (res.twoFactor) {
        setTicket(res.ticket);
        setBusy(false);
        return;
      }
      useApp.getState().setMe(res.me);
    } catch (err) {
      setError(errorText(err, "Não foi possível entrar"));
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!ticket) return;
    setBusy(true);
    setError(null);
    try {
      const { me } = await api.loginTwoFactor(ticket, code.trim());
      useApp.getState().setMe(me);
    } catch (err) {
      // tempo acabou (401): volta para a senha
      if (err instanceof ApiError && err.status === 401) {
        setTicket(null);
        setCode("");
      }
      setError(errorText(err, "Não foi possível entrar"));
      setBusy(false);
    }
  }

  const errorLine = error && (
    <p className="form-error" role="alert">
      {error}
    </p>
  );

  let body;
  if (mode === "signup") {
    body = <SignupForm />;
  } else if (mode === "forgot") {
    body = <ForgotPassword onDone={() => setMode("login")} />;
  } else if (ticket) {
    body = (
      <form onSubmit={submitCode} className="form">
        <label className="field">
          <span>Código de verificação</span>
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={20}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          <small>Os 6 números do seu app autenticador, ou um dos códigos de reserva.</small>
        </label>
        {errorLine}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setTicket(null);
            setCode("");
            setError(null);
          }}
        >
          Voltar
        </button>
      </form>
    );
  } else {
    body = (
      <form onSubmit={submit} className="form">
        <label className="field">
          <span>Usuário</span>
          <input
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Senha</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {errorLine}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
        <button type="button" className="link-btn" onClick={() => setMode("forgot")}>
          Esqueci minha senha
        </button>
      </form>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <img className="auth-mascot" src={rindo} alt="" width={464} height={480} decoding="async" />
        <h1 className="wordmark wordmark-lg">{APP_NAME}</h1>
        <p className="auth-lede">Voz, chat e vídeo para a sua turma.</p>
        {body}
        <p className="auth-foot">
          {mode === "signup" ? "Já tem conta? " : "Ainda não tem conta? "}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setMode(mode === "signup" ? "login" : "signup");
              setError(null);
            }}
          >
            {mode === "signup" ? "Entrar" : "Criar conta"}
          </button>
          {" · "}
          <Link to="/termos">Termos e privacidade</Link>
        </p>
      </section>
    </main>
  );
}

/** Esqueci a senha: o código vai para o e-mail confirmado da conta; com ele, a senha nova. */
function ForgotPassword({ onDone }: { onDone(): void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setErrors({});
    try {
      await task();
    } catch (err) {
      setErrors(err instanceof ApiError ? { ...err.fields, _: err.message } : { _: "Não deu certo. Tente de novo." });
    } finally {
      setBusy(false);
    }
  }

  const request = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.forgotPassword(email.trim());
      setSent(true);
    });
  };

  const reset = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.resetPassword(email.trim(), code.trim(), password);
      toast.info("Senha trocada. Entre com a nova.");
      onDone();
    });
  };

  const formError = errors._ && !errors.code && !errors.password && (
    <p className="form-error" role="alert">
      {errors._}
    </p>
  );

  if (!sent) {
    return (
      <form onSubmit={request} className="form">
        <label className="field">
          <span>E-mail da conta</span>
          <input autoFocus type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <small>Se ele estiver confirmado em uma conta, chega um código. Sem e-mail cadastrado, peça para um administrador.</small>
        </label>
        {formError}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Enviando…" : "Mandar código"}
        </button>
        <button type="button" className="link-btn" onClick={onDone}>
          Voltar
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={reset} className="form">
      <p className="muted small-note">Se {email.trim()} estiver cadastrado, chegou um código (olhe também o spam). Ele vale 15 minutos.</p>
      <label className="field" data-invalid={errors.code ? true : undefined}>
        <span>Código</span>
        <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
        {errors.code && <small className="field-error">{errors.code}</small>}
      </label>
      <label className="field" data-invalid={errors.password ? true : undefined}>
        <span>Senha nova</span>
        <input type="password" autoComplete="new-password" minLength={LIMITS.passwordMin} value={password} onChange={(e) => setPassword(e.target.value)} required />
        <small className={errors.password ? "field-error" : undefined}>{errors.password ?? `Pelo menos ${LIMITS.passwordMin} caracteres`}</small>
      </label>
      {formError}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "Trocando…" : "Trocar a senha"}
      </button>
      <button type="button" className="link-btn" onClick={() => setSent(false)}>
        Não chegou? Mandar de novo
      </button>
    </form>
  );
}
