/**
 * D-3xx (reversal of D-320) - the e-mail verification step `auto_verified_attributes =
 * ["email"]` requires after SignUp.tsx before the account can log in. `email` arrives as a
 * query param from SignUp's own redirect - re-typed here (never pre-filled from anything else,
 * mission §23's "no sensitive state in component memory across a navigation" discipline) so a
 * page reload or a direct link to this URL still works from the query string alone.
 */
import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle } from "lucide-react";
import { useConfirmSignUp, useResendConfirmationCode } from "../../hooks/useAuthActions.js";
import { PageHeader, Panel } from "../../components/ui/Layout.js";
import { Button } from "../../components/ui/Button.js";
import { Link } from "../../components/ui/Link.js";
import { TextField } from "../../components/forms/TextField.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import "./Auth.css";

export function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [confirmationCode, setConfirmationCode] = useState("");
  const confirm = useConfirmSignUp();
  const resend = useResendConfirmationCode();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    confirm.mutate(
      { email, confirmationCode },
      { onSuccess: () => navigate(`/login?${new URLSearchParams({ returnTo: "/overview" }).toString()}`, { replace: true }) },
    );
  }

  return (
    <>
      <PageHeader title="Confirme seu e-mail" description="Enviamos um código de confirmação para o e-mail informado no cadastro." />
      <Panel padded>
        <form onSubmit={handleSubmit}>
          <TextField label="E-mail" type="email" value={email} onChange={setEmail} autoComplete="username" required />
          <TextField label="Código de confirmação" type="text" value={confirmationCode} onChange={setConfirmationCode} autoComplete="one-time-code" required />
          <Button type="submit" variant="primary" icon={CheckCircle} pending={confirm.isPending}>
            {confirm.isPending ? "Confirmando…" : "Confirmar"}
          </Button>
          {confirm.isError ? (
            <InlineNotice tone="critical" announce="alert">
              Código inválido ou expirado.
            </InlineNotice>
          ) : null}
        </form>
        <Button
          variant="tertiary"
          size="sm"
          pending={resend.isPending}
          disabled={!email}
          onClick={() => resend.mutate({ email })}
        >
          {resend.isPending ? "Reenviando…" : "Reenviar código"}
        </Button>
        {resend.isSuccess ? (
          <InlineNotice tone="success" announce="status">
            Se o e-mail estiver registrado, um novo código foi enviado.
          </InlineNotice>
        ) : null}
        <p className="ui-auth-links">
          <Link to="/login">Voltar para o login</Link>
        </p>
      </Panel>
    </>
  );
}
