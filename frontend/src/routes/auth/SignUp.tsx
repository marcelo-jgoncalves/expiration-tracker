/**
 * D-3xx (reversal of D-320) - self-service signup, parity with the Hosted UI's own "Sign up"
 * link (the pool has no `admin_create_user_config` restricting registration to admins,
 * `infra/modules/cognito/main.tf` - self-service signup was already live before this change,
 * this screen is parity, not a new capability). On success, Cognito's
 * `auto_verified_attributes = ["email"]` requires the confirmation-code step (VerifyEmail.tsx)
 * before the account can log in.
 */
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { UserPlus } from "lucide-react";
import { useAuth } from "../../auth/AuthContext.js";
import { useSignUp } from "../../hooks/useAuthActions.js";
import { PageHeader, Panel } from "../../components/ui/Layout.js";
import { Button } from "../../components/ui/Button.js";
import { Link } from "../../components/ui/Link.js";
import { TextField } from "../../components/forms/TextField.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import { ApiError } from "../../api/errors.js";
import "./Auth.css";

export function SignUp() {
  const { state } = useAuth();
  const navigate = useNavigate();
  const signUp = useSignUp();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mismatchError, setMismatchError] = useState<string | undefined>();

  useEffect(() => {
    if (state.status === "AUTHENTICATED") {
      navigate("/overview", { replace: true });
    }
  }, [state.status, navigate]);

  useEffect(() => {
    if (signUp.isSuccess) {
      navigate(`/verify-email?${new URLSearchParams({ email }).toString()}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signUp.isSuccess, navigate]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setMismatchError("As senhas não coincidem.");
      return;
    }
    setMismatchError(undefined);
    signUp.mutate({ email, password });
  }

  const errorMessage =
    signUp.error instanceof ApiError
      ? signUp.error.category === "CONFLICT"
        ? "Já existe uma conta com este e-mail."
        : signUp.error.message
      : "Não foi possível criar a conta. Tente novamente.";

  return (
    <>
      <PageHeader title="Criar conta" description="Crie sua conta para começar a controlar seus vencimentos." />
      <Panel padded>
        <form onSubmit={handleSubmit}>
          <TextField label="E-mail" type="email" value={email} onChange={setEmail} autoComplete="username" required />
          <TextField
            label="Senha"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            required
            hint="Mínimo de 12 caracteres, com letra maiúscula, minúscula, número e símbolo."
          />
          <TextField label="Confirmar senha" type="password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" required error={mismatchError} />
          <Button type="submit" variant="primary" icon={UserPlus} pending={signUp.isPending}>
            {signUp.isPending ? "Criando conta…" : "Criar conta"}
          </Button>
          {signUp.isError ? (
            <InlineNotice tone="critical" announce="alert">
              {errorMessage}
            </InlineNotice>
          ) : null}
        </form>
        <p className="ui-auth-links">
          Já tem conta? <Link to="/login">Entrar</Link>
        </p>
      </Panel>
    </>
  );
}
