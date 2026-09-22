/**
 * D-3xx (reversal of D-320) - `POST /bff/forgot-password/confirm`, the code + new password step
 * following ForgotPassword.tsx.
 */
import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { useConfirmForgotPassword } from "../../hooks/useAuthActions.js";
import { PageHeader, Panel } from "../../components/ui/Layout.js";
import { Button } from "../../components/ui/Button.js";
import { Link } from "../../components/ui/Link.js";
import { TextField } from "../../components/forms/TextField.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import "./Auth.css";

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mismatchError, setMismatchError] = useState<string | undefined>();
  const confirmForgotPassword = useConfirmForgotPassword();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setMismatchError("As senhas não coincidem.");
      return;
    }
    setMismatchError(undefined);
    confirmForgotPassword.mutate(
      { email, confirmationCode, newPassword },
      { onSuccess: () => navigate(`/login?${new URLSearchParams({ returnTo: "/overview" }).toString()}`, { replace: true }) },
    );
  }

  return (
    <>
      <PageHeader title="Redefinir senha" description="Informe o código recebido por e-mail e escolha uma nova senha." />
      <Panel padded>
        <form onSubmit={handleSubmit}>
          <TextField label="E-mail" type="email" value={email} onChange={setEmail} autoComplete="username" required />
          <TextField label="Código de confirmação" type="text" value={confirmationCode} onChange={setConfirmationCode} autoComplete="one-time-code" required />
          <TextField
            label="Nova senha"
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            required
            hint="Mínimo de 12 caracteres, com letra maiúscula, minúscula, número e símbolo."
          />
          <TextField label="Confirmar nova senha" type="password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" required error={mismatchError} />
          <Button type="submit" variant="primary" icon={KeyRound} pending={confirmForgotPassword.isPending}>
            {confirmForgotPassword.isPending ? "Redefinindo…" : "Redefinir senha"}
          </Button>
          {confirmForgotPassword.isError ? (
            <InlineNotice tone="critical" announce="alert">
              Código inválido/expirado, ou a senha não atende aos requisitos mínimos.
            </InlineNotice>
          ) : null}
        </form>
        <p className="ui-auth-links">
          <Link to="/login">Voltar para o login</Link>
        </p>
      </Panel>
    </>
  );
}
