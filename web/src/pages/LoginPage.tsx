import { useState, type FormEvent } from "react";
import { APP_NAME } from "@resenha/shared";
import rindo from "../assets/mascote/rindo.webp";
import { api, ApiError } from "../lib/api.ts";
import { useApp } from "../state/app.ts";
import { SignupForm } from "./SignupForm.tsx";

export function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { me } = await api.login(username, password);
      useApp.getState().setMe(me);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível entrar");
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <img className="auth-mascot" src={rindo} alt="" width={464} height={480} decoding="async" />
        <h1 className="wordmark wordmark-lg">{APP_NAME}</h1>
        <p className="auth-lede">Voz, chat e vídeo para a sua turma.</p>
        {mode === "signup" ? (
          <SignupForm />
        ) : (
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
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Entrando…" : "Entrar"}
            </button>
          </form>
        )}
        <p className="auth-foot">
          {mode === "signup" ? "Já tem conta? " : "Ainda não tem conta? "}
          <button type="button" className="link-btn" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>
            {mode === "signup" ? "Entrar" : "Criar conta"}
          </button>
        </p>
      </section>
    </main>
  );
}
