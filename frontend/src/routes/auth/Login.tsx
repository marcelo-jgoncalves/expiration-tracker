/**
 * D-3xx (reversal of D-320) - the app's own login screen, replacing the redirect to Cognito's
 * Hosted UI/Managed Login as the frontend's real entry point (Marcelo chose visual fidelity
 * with the rest of the v2 design system over the Hosted UI's lower-effort/lower-risk path - see
 * decisions-log.md D-3xx). Same design-system components/tokens (Panel, TextField, Button,
 * violet accent, Plus Jakarta Sans, Lucide icons) as every other screen - no bespoke "auth
 * layout" invented, matching Onboarding.tsx/AcceptInvitation.tsx's own precedent of rendering
 * directly (no AppShell) outside the authenticated tree.
 *
 * Public route (App.tsx) - redirects an already-AUTHENTICATED visitor away rather than showing
 * a login form to someone who doesn't need one.
 */
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LogIn } from "lucide-react";
import { useAuth } from "../../auth/AuthContext.js";
import { useLogin } from "../../hooks/useAuthActions.js";
import { PageHeader, Panel } from "../../components/ui/Layout.js";
import { Button } from "../../components/ui/Button.js";
import { Link } from "../../components/ui/Link.js";
import { TextField } from "../../components/forms/TextField.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import "./Auth.css";

function isSafeReturnTo(path: string | null): path is string {
  return Boolean(path) && path!.startsWith("/") && !path!.startsWith("//") && !path!.includes("://");
}

export function Login() {
  const { state } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = isSafeReturnTo(searchParams.get("returnTo")) ? searchParams.get("returnTo")! : "/overview";
  const login = useLogin();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Real achado de Marcelo, 2026-09-22 ("entro com as credenciais e não acontece nada, fica na
  // tela"): esse efeito costumava navegar assim que `login.isSuccess` virava true, mas
  // `useLogin`'s `onSuccess` só DISPARA `invalidateQueries(sessionQueryKey)` - não espera o
  // refetch resolver. `login.isSuccess` liga bem antes de `AuthContext`'s `sessionQuery` refletir
  // a sessão nova, então a navegação para `returnTo` acontecia com `state.status` ainda
  // SESSION_MISSING (dado velho em cache) - `ProtectedRoute` via isso, achava que não estava
  // autenticado, e chamava `reauthenticate()` de volta para `/login` (um mount novo, sem as
  // credenciais digitadas, parecendo "travado"). Único gatilho de navegação agora é `state.status
  // === AUTHENTICATED` (abaixo) - a fonte de verdade real, nunca o retorno otimista da mutation.
  useEffect(() => {
    if (state.status === "AUTHENTICATED") {
      navigate(returnTo, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- returnTo read fresh only at the moment of the check, not tracked as a reactive dependency.
  }, [state.status, navigate]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    login.mutate({ email, password });
  }

  return (
    <>
      <PageHeader title="Entrar" description="Acesse sua conta para continuar." />
      <Panel padded>
        <form onSubmit={handleSubmit}>
          <TextField label="E-mail" type="email" value={email} onChange={setEmail} autoComplete="username" required />
          <TextField label="Senha" type="password" value={password} onChange={setPassword} autoComplete="current-password" required />
          <Button type="submit" variant="primary" icon={LogIn} pending={login.isPending}>
            {login.isPending ? "Entrando…" : "Entrar"}
          </Button>
          {login.isError ? (
            <InlineNotice tone="critical" announce="alert">
              E-mail ou senha inválidos.
            </InlineNotice>
          ) : null}
        </form>
        <p className="ui-auth-links">
          <Link to="/forgot-password">Esqueceu sua senha?</Link>
        </p>
        <p className="ui-auth-links">
          Não tem conta? <Link to="/signup">Criar conta</Link>
        </p>
      </Panel>
    </>
  );
}
