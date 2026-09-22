/**
 * D-3xx (reversal of D-320) - `POST /bff/forgot-password`, always resolves the same way
 * regardless of whether the e-mail is registered (anti-enumeration, decision 3 - see
 * BffAuthService.startForgotPassword's doc comment). The confirmation copy below reflects that
 * honestly ("se o e-mail estiver cadastrado…") rather than claiming a certainty this screen
 * structurally cannot have.
 */
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Mail } from "lucide-react";
import { useForgotPassword } from "../../hooks/useAuthActions.js";
import { PageHeader, Panel } from "../../components/ui/Layout.js";
import { Button } from "../../components/ui/Button.js";
import { Link } from "../../components/ui/Link.js";
import { TextField } from "../../components/forms/TextField.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import "./Auth.css";

export function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const forgotPassword = useForgotPassword();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    forgotPassword.mutate({ email });
  }

  if (forgotPassword.isSuccess) {
    return (
      <>
        <PageHeader title="Verifique seu e-mail" />
        <Panel padded>
          <InlineNotice tone="success" announce="status">
            Se o e-mail informado estiver cadastrado, enviamos um código para redefinir a senha.
          </InlineNotice>
          <Button variant="primary" onClick={() => navigate(`/reset-password?${new URLSearchParams({ email }).toString()}`)}>
            Já tenho o código
          </Button>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Esqueceu sua senha?" description="Informe seu e-mail para receber um código de redefinição." />
      <Panel padded>
        <form onSubmit={handleSubmit}>
          <TextField label="E-mail" type="email" value={email} onChange={setEmail} autoComplete="username" required />
          <Button type="submit" variant="primary" icon={Mail} pending={forgotPassword.isPending}>
            {forgotPassword.isPending ? "Enviando…" : "Enviar código"}
          </Button>
        </form>
        <p className="ui-auth-links">
          <Link to="/login">Voltar para o login</Link>
        </p>
      </Panel>
    </>
  );
}
