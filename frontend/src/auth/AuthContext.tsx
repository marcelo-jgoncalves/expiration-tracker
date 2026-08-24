/**
 * Auth state machine (Frontend Production Foundation mission §21-23). The 6 required states
 * exist as a real discriminated union; which ones are reachable depends on this BFF's actual
 * design (D-053/D-054: refresh is 100% transparent server-side - "frontend nunca chama
 * endpoint de refresh, só reage a 401 de sessão morta"), documented per-state below rather
 * than assumed.
 *
 * Return context (mission §23): captured as the current path only (never anything from
 * component state/form values - "não armazenar informações sensíveis indevidamente"),
 * round-tripped through the BFF's own server-side LoginAttempt record
 * (BffAuthService.startLogin's `returnTo`), never client-side storage.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchSessionInfo, logout as bffLogout, logoutAll as bffLogoutAll, startLogin, SessionProbeError } from "../api/session.js";
import { apiClient } from "../api/apiClient.js";

export type AuthState =
  /** Initial session probe in flight (also re-entered on an explicit re-check). */
  | { status: "SESSION_REFRESHING" }
  | { status: "AUTHENTICATED"; tenantId: string; userId: string }
  /** The BFF says plainly "not authenticated" (no cookie, or a resolved-but-invalid one) -
   * this is the common "never logged in on this browser" case. */
  | { status: "SESSION_MISSING" }
  /** Was AUTHENTICATED; a subsequent API call came back 401 (ApiClient's onUnauthorized).
   * Distinct from SESSION_MISSING: this is a session that existed and is now gone
   * (absolute/idle expiry, or the BFF's refresh definitively failed - see
   * RefreshOutcome.DEFINITIVE_AUTH_FAILURE, which the BFF turns into a 401, never a silently
   * "still authenticated" response). */
  | { status: "SESSION_EXPIRED"; returnTo: string }
  /** The session probe itself could not be completed (network/parse failure talking to
   * /bff/session) while re-validating on load - distinct from SESSION_MISSING (which is a
   * definitive "no" from the BFF): here we genuinely don't know, so the UI should say so
   * rather than silently treating "couldn't check" the same as "definitely logged out". */
  | { status: "REFRESH_FAILED"; returnTo: string }
  /** The user has acknowledged SESSION_EXPIRED/REFRESH_FAILED (or clicked a protected link
   * while SESSION_MISSING) and is about to be sent to Cognito via startLogin(). */
  | { status: "REAUTH_REQUIRED"; returnTo: string };

interface AuthContextValue {
  state: AuthState;
  /** Registers the 401 handler exactly once - ApiClient instances call this, never the
   * reverse: apiClient never imports AuthContext, only a plain setter it exposes for exactly
   * this purpose - see apiClient.setOnUnauthorized wired below). */
  reportUnauthorized: () => void;
  reauthenticate: () => void;
  logout: () => Promise<void>;
  logoutEverywhere: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "SESSION_REFRESHING" });

  const probe = useCallback(async () => {
    setState({ status: "SESSION_REFRESHING" });
    try {
      const info = await fetchSessionInfo();
      if (info.authenticated && info.tenantId && info.userId) {
        setState({ status: "AUTHENTICATED", tenantId: info.tenantId, userId: info.userId });
      } else {
        setState({ status: "SESSION_MISSING" });
      }
    } catch (err) {
      if (err instanceof SessionProbeError) {
        setState({ status: "REFRESH_FAILED", returnTo: currentPath() });
        return;
      }
      setState({ status: "SESSION_MISSING" });
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  const reportUnauthorized = useCallback(() => {
    setState((prev) => (prev.status === "AUTHENTICATED" ? { status: "SESSION_EXPIRED", returnTo: currentPath() } : prev));
  }, []);

  useEffect(() => {
    apiClient.setOnUnauthorized(reportUnauthorized);
  }, [reportUnauthorized]);

  const reauthenticate = useCallback(() => {
    setState((prev) => {
      const returnTo = "returnTo" in prev ? prev.returnTo : currentPath();
      startLogin(returnTo); // full-page navigation - nothing after this line runs
      return { status: "REAUTH_REQUIRED", returnTo };
    });
  }, []);

  const logout = useCallback(async () => {
    await bffLogout();
    setState({ status: "SESSION_MISSING" });
  }, []);

  const logoutEverywhere = useCallback(async () => {
    await bffLogoutAll();
    setState({ status: "SESSION_MISSING" });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, reportUnauthorized, reauthenticate, logout, logoutEverywhere }),
    [state, reportUnauthorized, reauthenticate, logout, logoutEverywhere],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider.");
  return ctx;
}
