/**
 * Protected routing (mission §22): unauthenticated -> authentication, expired session ->
 * reauthentication, successful reauthentication -> return context. D-3xx (reversal of D-320):
 * the app's own `/login` screen is same-origin now, so `AuthContext.reauthenticate()` does a
 * normal client-side `navigate()` (with `returnTo` as a query param) instead of the old
 * full-page redirect to the Cognito Hosted UI - this component still only decides WHEN to
 * trigger that navigation, not how.
 */
import { useEffect, type ReactNode } from "react";
import { useAuth } from "./AuthContext.js";
import { InitialLoading } from "../components/AsyncStates.js";

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
      // D-136/D-A: neutral, structural loading state - never technical wording ("validating
      // session") exposed to the user (Marcelo's real report). Shares the exact component
      // OnboardingGate uses for its own pending state, so the two stages of the startup
      // sequence read as one continuous load, not two distinct messages.
      return <InitialLoading />;
    case "SESSION_MISSING":
    case "SESSION_EXPIRED":
    case "REFRESH_FAILED":
    case "REAUTH_REQUIRED":
      // A full-page redirect is already in flight (or about to be, via the effect above) -
      // this is the brief structural placeholder shown in the instant before navigation
      // actually happens, never a dead end the user could get stuck on.
      return <InitialLoading label="Redirecionando…" />;
  }
}
