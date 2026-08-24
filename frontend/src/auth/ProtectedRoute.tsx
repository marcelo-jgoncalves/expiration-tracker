/**
 * Protected routing (mission §22): unauthenticated -> authentication, expired session ->
 * reauthentication, successful reauthentication -> return context. The actual redirect to
 * Cognito happens via full-page navigation (startLogin), never client-side routing - the
 * BFF's own LoginAttempt record is what remembers where to return to (server-side, mission
 * §23), this component only decides WHEN to trigger that navigation.
 */
import { useEffect, type ReactNode } from "react";
import { useAuth } from "./AuthContext.js";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { state, reauthenticate } = useAuth();

  useEffect(() => {
    if (state.status === "SESSION_MISSING" || state.status === "SESSION_EXPIRED" || state.status === "REFRESH_FAILED") {
      reauthenticate();
    }
  }, [state.status, reauthenticate]);

  switch (state.status) {
    case "AUTHENTICATED":
      return <>{children}</>;
    case "SESSION_REFRESHING":
      return (
        <div role="status" aria-live="polite">
          Verificando sua sessão…
        </div>
      );
    case "SESSION_MISSING":
    case "SESSION_EXPIRED":
    case "REFRESH_FAILED":
    case "REAUTH_REQUIRED":
      // A full-page redirect is already in flight (or about to be, via the effect above) -
      // this is the brief structural placeholder shown in the instant before navigation
      // actually happens, never a dead end the user could get stuck on.
      return (
        <div role="status" aria-live="polite">
          Redirecionando para o login…
        </div>
      );
  }
}
