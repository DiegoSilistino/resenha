import { useEffect, useState, type FormEvent } from "react";
import { toDataURL } from "qrcode";
import { Copy } from "lucide-react";
import type { AccountSecurity as Security } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { api, ApiError } from "../lib/api.ts";
import { displayNameOf, useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";

type Errors = Record<string, string>;

/** Erro do servidor no campo certo (ou embaixo do formulário); sem resposta do servidor, um aviso. */
function useForm() {
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  async function run<T>(task: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setErrors({});
    try {
      return await task();
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fields, _: err.message });
      else toast.fromError(err);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { errors, busy, run };
}

function FieldError({ errors, name }: { errors: Errors; name: string }) {
  return errors[name] ? <small className="field-error">{errors[name]}</small> : null;
}

/** Erro geral, quando não é de um campo que já mostra o próprio. */
function FormError({ errors, fields }: { errors: Errors; fields: string[] }) {
  if (!errors._ || fields.some((f) => errors[f])) return null;
  return (
    <p className="form-error" role="alert">
      {errors._}
    </p>
  );
}

/** Configurações → Conta: e-mail para recuperar a senha, verificação em duas etapas e quem você bloqueou. */
export function AccountSecurity() {
  const [security, setSecurity] = useState<Security | null>(null);
  useEffect(() => {
    api.security().then(setSecurity, (err) => toast.fromError(err));
  }, []);
  if (!security) return <p className="muted">Carregando…</p>;
  return (
    <>
      <EmailSection security={security} onChange={setSecurity} />
      <hr />
      <TwoFactorSection security={security} onChange={setSecurity} />
      <hr />
      <BlockedSection />
    </>
  );
}

function EmailSection({ security, onChange }: { security: Security; onChange(s: Security): void }) {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const { errors, busy, run } = useForm();

  if (!security.mailEnabled && !security.email) {
    return (
      <section className="form">
        <h3>E-mail</h3>
        <p className="muted small-note">
          Este servidor ainda não manda e-mail, então recuperar a senha por e-mail está desligado. Se esquecer a senha, peça
          para um administrador.
        </p>
      </section>
    );
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const next = await run(() => api.setEmail(email.trim(), password));
    if (next) {
      onChange(next);
      setEditing(false);
      setPassword("");
    }
  }

  async function confirmCode(e: FormEvent) {
    e.preventDefault();
    const next = await run(() => api.confirmEmail(code.trim()));
    if (next) {
      onChange(next);
      setCode("");
      toast.info("E-mail confirmado.");
    }
  }

  async function remove() {
    const next = await run(() => api.removeEmail(password));
    if (next) {
      onChange(next);
      setEditing(false);
      setPassword("");
      toast.info("E-mail tirado da conta.");
    }
  }

  return (
    <section className="form">
      <h3>E-mail</h3>
      <p className="muted small-note">Para recuperar a senha se você esquecer. Ninguém mais vê.</p>
      {!editing && (
        <p className="account-line">
          {security.email ? (
            <>
              <strong>{security.email}</strong> <span className="muted">confirmado</span>
            </>
          ) : (
            <span className="muted">Nenhum e-mail cadastrado.</span>
          )}{" "}
          <button type="button" className="link-btn" onClick={() => setEditing(true)}>
            {security.email ? "Trocar ou tirar" : "Cadastrar"}
          </button>
        </p>
      )}

      {security.pendingEmail && !editing && (
        <form className="form" onSubmit={confirmCode}>
          <label className="field" data-invalid={errors.code ? true : undefined}>
            <span>Código que chegou em {security.pendingEmail}</span>
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
            <FieldError errors={errors} name="code" />
          </label>
          <FormError errors={errors} fields={["code"]} />
          <button className="btn btn-primary" disabled={busy}>
            Confirmar e-mail
          </button>
        </form>
      )}

      {editing && (
        <form className="form" onSubmit={send}>
          <label className="field" data-invalid={errors.email ? true : undefined}>
            <span>E-mail</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <FieldError errors={errors} name="email" />
          </label>
          <label className="field" data-invalid={errors.password ? true : undefined}>
            <span>Sua senha</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <FieldError errors={errors} name="password" />
          </label>
          <FormError errors={errors} fields={["email", "password"]} />
          <div className="row-actions">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Enviando…" : "Mandar código"}
            </button>
            {security.email && (
              <button type="button" className="btn btn-ghost" disabled={busy || !password} onClick={() => void remove()}>
                Tirar e-mail
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

type Setup = { step: "password" } | { step: "scan"; secret: string; qr: string } | { step: "codes"; codes: string[] };

function TwoFactorSection({ security, onChange }: { security: Security; onChange(s: Security): void }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const { errors, busy, run } = useForm();

  async function start(e: FormEvent) {
    e.preventDefault();
    const res = await run(() => api.setupTwoFactor(password));
    if (!res) return;
    setPassword("");
    setSetup({ step: "scan", secret: res.secret, qr: await toDataURL(res.url, { margin: 1, width: 200 }) });
  }

  async function enable(e: FormEvent) {
    e.preventDefault();
    const res = await run(() => api.enableTwoFactor(code.trim()));
    if (!res) return;
    setCode("");
    setSetup({ step: "codes", codes: res.recoveryCodes });
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    const next = await run(() => api.disableTwoFactor(password, code.trim()));
    if (next) {
      onChange(next);
      setPassword("");
      setCode("");
      toast.info("Verificação em duas etapas desligada.");
    }
  }

  const title = <h3>Verificação em duas etapas</h3>;

  if (setup?.step === "codes") {
    return (
      <section className="form">
        {title}
        <p>Ligada! Guarde estes códigos de reserva num lugar seguro: cada um entra uma vez, se você ficar sem o celular.</p>
        <ul className="recovery-codes">
          {setup.codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="row-actions">
          <button
            type="button"
            className="btn"
            onClick={() =>
              void navigator.clipboard.writeText(setup.codes.join("\n")).then(
                () => toast.info("Códigos copiados."),
                () => toast.error("Não deu para copiar; anote os códigos."),
              )
            }
          >
            <Copy size={16} aria-hidden="true" /> Copiar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setSetup(null);
              onChange({ ...security, twoFactor: true });
            }}
          >
            Guardei os códigos
          </button>
        </div>
      </section>
    );
  }

  if (security.twoFactor) {
    return (
      <section className="form">
        {title}
        <p className="account-line">
          <strong>Ligada.</strong> <span className="muted">Para entrar, além da senha, vale o código do app autenticador.</span>
        </p>
        <form className="form" onSubmit={disable}>
          <label className="field" data-invalid={errors.password ? true : undefined}>
            <span>Sua senha</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <FieldError errors={errors} name="password" />
          </label>
          <label className="field" data-invalid={errors.code ? true : undefined}>
            <span>Código do app (ou um de reserva)</span>
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} required />
            <FieldError errors={errors} name="code" />
          </label>
          <FormError errors={errors} fields={["password", "code"]} />
          <button className="btn btn-danger" disabled={busy}>
            Desligar
          </button>
        </form>
      </section>
    );
  }

  if (setup?.step === "scan") {
    return (
      <section className="form">
        {title}
        <p>
          Abra o app autenticador (Google Authenticator, Microsoft Authenticator, Authy…), toque em adicionar e leia o QR.
          Depois digite o código de 6 números que aparece nele.
        </p>
        <img className="totp-qr" src={setup.qr} alt="QR para o app autenticador" width={200} height={200} />
        <p className="small-note muted">
          Sem câmera? Digite esta chave no app: <code className="totp-secret">{setup.secret}</code>
        </p>
        <form className="form" onSubmit={enable}>
          <label className="field" data-invalid={errors.code ? true : undefined}>
            <span>Código do app</span>
            <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
            <FieldError errors={errors} name="code" />
          </label>
          <FormError errors={errors} fields={["code"]} />
          <div className="row-actions">
            <button className="btn btn-primary" disabled={busy}>
              Ligar
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setSetup(null)}>
              Cancelar
            </button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="form">
      {title}
      <p className="muted small-note">
        Além da senha, o login pede um código do app autenticador do seu celular. Mesmo que alguém descubra a sua senha, não
        entra sem o celular.
      </p>
      {setup?.step === "password" ? (
        <form className="form" onSubmit={start}>
          <label className="field" data-invalid={errors.password ? true : undefined}>
            <span>Sua senha</span>
            <input autoFocus type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <FieldError errors={errors} name="password" />
          </label>
          <FormError errors={errors} fields={["password"]} />
          <div className="row-actions">
            <button className="btn btn-primary" disabled={busy}>
              Continuar
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setSetup(null)}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn" onClick={() => setSetup({ step: "password" })}>
          Ligar verificação em duas etapas
        </button>
      )}
    </section>
  );
}

function BlockedSection() {
  const blocked = useApp((s) => s.blocked);
  const users = useApp((s) => s.users);
  return (
    <section className="form">
      <h3>Bloqueados</h3>
      {blocked.length === 0 ? (
        <p className="muted small-note">Ninguém. Para bloquear alguém, abra o perfil da pessoa.</p>
      ) : (
        <ul className="admin-list">
          {blocked.map((id) => (
            <li key={id}>
              <Avatar user={users[id]} size={28} />
              <div className="admin-list-main">
                <strong>{displayNameOf(users, id)}</strong>
              </div>
              <button type="button" className="btn btn-small" onClick={() => void api.unblock(id).catch((err) => toast.fromError(err))}>
                Desbloquear
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
