import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext.js";
import { useLogin } from "../../hooks/useAuthActions.js";
import { ApiError } from "../../api/errors.js";
import { InitialLoading } from "../../components/AsyncStates.js";
import "./Login.css";

export function safeLoginDestination(path: string | null): string {
  if (!path || !path.startsWith("/") || (path.includes("\\") || [...path].some(char => char.charCodeAt(0) <= 32)) || path.startsWith("//")) return "/dashboard";
  const url = new URL(path, window.location.origin);
  return url.origin === window.location.origin && url.pathname !== "/login" ? path : "/dashboard";
}

export function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.";
    if (error.category === "NETWORK") return "Não foi possível conectar. Verifique sua conexão e tente novamente.";
    if (error.status === 401 || error.category === "AUTH") return "Não foi possível entrar. Confira seus dados e tente novamente.";
  }
  return "O acesso está temporariamente indisponível. Tente novamente em alguns instantes.";
}

export function Login() {
  const { state } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const destination = safeLoginDestination(params.get("returnTo"));
  const login = useLogin();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<"email" | "password" | null>(null);

  useEffect(() => { document.title = "Entrar · OmniVence"; }, []);
  useEffect(() => {
    if (state.status === "AUTHENTICATED") navigate(destination, { replace: true });
  }, [state.status, navigate, destination]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || login.isPending) return;
    setError("");
    setInvalid(null);
    const trimmed = email.trim();
    setEmail(trimmed);
    if (emailRef.current) emailRef.current.value = trimmed;
    if (!trimmed || !emailRef.current?.validity.valid) {
      setError("Informe um e-mail válido para continuar.");
      setInvalid("email");
      emailRef.current?.focus();
      return;
    }
    if (!password) {
      setError("Informe sua senha para continuar.");
      setInvalid("password");
      passwordRef.current?.focus();
      return;
    }
    submitting.current = true;
    login.mutate({ email: trimmed, password }, {
      onError: (failure) => {
        setError(loginErrorMessage(failure));
        setPassword("");
        submitting.current = false;
        login.reset();
      },
      onSuccess: () => { setPassword(""); submitting.current = false; login.reset(); },
    });
  }

  if (state.status === "SESSION_REFRESHING" || state.status === "AUTHENTICATED") return <InitialLoading />;

  return <div className="ov-login-layout">
    <aside className="ov-login-story" aria-label="Apresentação da OmniVence">
      <div className="ov-login-story-top">OmniVence</div>
      <div className="ov-login-story-copy">
        <span className="ov-login-eyebrow">CONTINUIDADE SOB CONTROLE</span>
        <h2>Antecipe prazos.<br />Cuide do que vem depois.</h2>
        <p>Documentos, responsáveis e vencimentos conectados para que sua equipe acompanhe cada pendência até a resolução.</p>
      </div>
      <div className="ov-login-story-bottom">Clareza para agir no momento certo.</div>
    </aside>
    <main className="ov-login-main">
      <img className="ov-login-brand" src="/brand/omnivence.png" alt="OmniVence — Gestão inteligente de vencimentos" />
      <div className="ov-login-form-wrap">
        <div className="ov-login-intro"><h1>Acesse sua conta</h1><p>Entre para acompanhar prazos e manter tudo em dia.</p></div>
        {state.status === "SESSION_EXPIRED" && <p role="status">Sua sessão expirou. Entre novamente para continuar.</p>}
        <form onSubmit={submit} noValidate>
          {error && <div className="ov-login-alert ov-login-show" role="alert">{error}</div>}
          <div className="ov-login-field">
            <label htmlFor="login-email">E-mail</label>
            <input ref={emailRef} id="login-email" name="email" type="email" inputMode="email" autoComplete="username" placeholder="voce@empresa.com.br" required value={email} onChange={e => { setEmail(e.target.value); if (invalid === "email") setInvalid(null); }} aria-invalid={invalid === "email" || undefined} aria-describedby={invalid === "email" ? "login-email-error" : undefined} />
            {invalid === "email" && <span id="login-email-error" className="ov-login-field-error">{error}</span>}
          </div>
          <div className="ov-login-field">
            <label htmlFor="login-password">Senha</label>
            <div className="ov-login-password">
              <input ref={passwordRef} id="login-password" name="password" type={visible ? "text" : "password"} autoComplete="current-password" placeholder="Digite sua senha" required value={password} onChange={e => { setPassword(e.target.value); if (invalid === "password") setInvalid(null); }} aria-invalid={invalid === "password" || undefined} aria-describedby={invalid === "password" ? "login-password-error" : undefined} />
              <button className="ov-login-toggle" type="button" aria-label={visible ? "Ocultar senha" : "Mostrar senha"} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? "Ocultar" : "Mostrar"}</button>
            </div>
            {invalid === "password" && <span id="login-password-error" className="ov-login-field-error">{error}</span>}
          </div>
          <div className="ov-login-row"><Link className="ov-login-link" to="/recuperar-senha">Esqueceu a senha?</Link></div>
          <button className="ov-login-submit" type="submit" disabled={login.isPending || submitting.current}>{login.isPending || submitting.current ? "Entrando…" : "Entrar"}</button>
          <span className="u-visually-hidden" aria-live="polite">{login.isPending ? "Entrando…" : ""}</span>
        </form>
        <p className="ov-login-hint">O acesso é fornecido pela sua organização. Se ainda não recebeu um convite, fale com o administrador da sua equipe.</p>
      </div>
      <div className="ov-login-footer">© {new Date().getFullYear()} OmniVence</div>
    </main>
  </div>;
}
