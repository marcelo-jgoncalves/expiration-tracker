/**
 * Accept invitation (Wave B2B-14, D-120) - `handleAcceptInvitation`/`POST /bff/invitations/accept`
 * existed since Wave B2B-8 (D-099) but no frontend route ever called it, found only by trying the
 * real invite flow end-to-end. Rendered as a sibling of the main `ProtectedRoute` group (App.tsx),
 * never nested under `ActiveOrganizationProvider`/`OnboardingGate` - the invited identity may have
 * zero Memberships anywhere yet, exactly the case those assume never happens.
 *
 * `ProtectedRoute` alone (no Organization requirement) covers "not logged in yet" - Cognito Hosted
 * UI redirect + BFF's server-side LoginAttempt return-to already bring the caller back to this
 * exact URL (token included) once authenticated, so a fresh invitee's path is:
 * click e-mail link -> log in / sign up -> land back here -> accept fires automatically.
 */
import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAcceptInvitation } from "../hooks/useAcceptInvitation.js";
import { ApiError, isConflict } from "../api/errors.js";
import { PageHeader, Panel } from "../components/ui/Layout.js";
import { Button } from "../components/ui/Button.js";
import { InlineNotice } from "../components/ui/InlineNotice.js";

export function AcceptInvitation() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();
  const accept = useAcceptInvitation();
  // Fires the mutation exactly once per mount, even under React 18 StrictMode's double-invoke
  // of effects in development - a manual "Tentar novamente" click is the only other trigger.
  const attempted = useRef(false);

  useEffect(() => {
    if (token && !attempted.current) {
      attempted.current = true;
      accept.mutate(token);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (accept.isSuccess) navigate("/overview", { replace: true });
  }, [accept.isSuccess, navigate]);

  const header = <PageHeader title="Aceitar convite" description="Entrando na organização que te convidou." />;

  if (!token) {
    return (
      <>
        {header}
        <Panel>
          <InlineNotice tone="critical" announce="alert">
            Link de convite inválido - faltando o token. Peça um novo convite.
          </InlineNotice>
        </Panel>
      </>
    );
  }

  if (accept.isPending || accept.isSuccess) {
    return (
      <>
        {header}
        <Panel>
          <div role="status" aria-live="polite">
            Aceitando convite…
          </div>
        </Panel>
      </>
    );
  }

  if (accept.isError) {
    const message =
      accept.error instanceof ApiError && isConflict(accept.error)
        ? "Você já é membro desta organização."
        : "Não foi possível aceitar o convite. Ele pode ter expirado ou já ter sido usado - peça um novo.";
    return (
      <>
        {header}
        <Panel>
          <InlineNotice tone="critical" announce="alert">
            {message}
          </InlineNotice>
          {isConflict(accept.error) ? (
            <Button variant="primary" onClick={() => navigate("/overview", { replace: true })}>
              Ir para a visão geral
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                attempted.current = true;
                accept.mutate(token);
              }}
            >
              Tentar novamente
            </Button>
          )}
        </Panel>
      </>
    );
  }

  return <>{header}</>;
}
