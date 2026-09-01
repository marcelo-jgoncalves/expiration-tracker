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
 *
 * D-136/D-A (performance hot-path): derives its state from the SAME `sessionQueryKey` TanStack
 * Query that `ActiveOrganizationContext` reads, instead of an imperative `fetchSessionInfo()`
 * call of its own - the pre-D-136 shape had both contexts independently probing
 * `/bff/session` on every load, a real waterfall (Marcelo's "tela demora" + "validando
 * sessão" report). `staleTime` on the shared query means a normal reload does not repeat the
 * request; a UI cache window this short has no bearing on server-side authorization, which the
 * BFF re-validates on every real operation regardless of what the client believes.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSessionInfo, logout as bffLogout, logoutAll as bffLogoutAll, startLogin, SessionProbeError } from "../api/session.js";
import { apiClient } from "../api/apiClient.js";
import { sessionQueryKey } from "../api/queryKeys.js";

export type AuthState =
  /** Initial session probe in flight (also re-entered on an explicit re-check). */
  | { status: "SESSION_REFRESHING" }
  /** Organization selection (activeOrganizationId, onboardingState, organizationSelectionRequired)
   * is deliberately NOT part of this state (Wave B2B-10 design decision, `reviews/
   * multi-user-b2b-wave-b2b10-scoping/`) — authentication and tenant selection have different
   * lifecycles; that data lives in `ActiveOrganizationContext`, consumed only by components
   * already inside AUTHENTICATED. */
  | { status: "AUTHENTICATED" }
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
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: sessionQueryKey,
    queryFn: ({ signal }) => fetchSessionInfo({ signal }),
    // 30s: short enough that a real revocation/expiry is caught on the next natural
    // navigation, long enough that AuthProvider and ActiveOrganizationProvider mounting a few
    // hundred ms apart (the common case, since the latter mounts only once the former resolves
    // AUTHENTICATED) share one network call instead of two. Never a substitute for
    // authorization - every real mutation still round-trips through the BFF, which re-checks
    // the session server-side regardless of what this cache believes.
    staleTime: 30_000,
  });

  // Latches SESSION_EXPIRED once a real 401 arrives, so a subsequent stale-cache read of the
  // now-removed query never renders a moment of "still AUTHENTICATED" — the only way out of
  // this state is `reauthenticate()`'s full-page navigation, which remounts this provider
  // fresh, so this never needs to be reset from within the same tree lifetime. Real React
  // state (not a ref) — setting it must trigger the re-render that flips `state` below.
  const [reportedUnauthorized, setReportedUnauthorized] = useState(false);

  const state: AuthState = useMemo(() => {
    if (reportedUnauthorized) {
      return { status: "SESSION_EXPIRED", returnTo: currentPath() };
    }
    if (sessionQuery.isPending) return { status: "SESSION_REFRESHING" };
    if (sessionQuery.isError) {
      const err = sessionQuery.error;
      if (err instanceof SessionProbeError) {
        return { status: "REFRESH_FAILED", returnTo: currentPath() };
      }
      return { status: "SESSION_MISSING" };
    }
    return sessionQuery.data.authenticated ? { status: "AUTHENTICATED" } : { status: "SESSION_MISSING" };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- currentPath() is intentionally read fresh only at the moment of transition, not tracked as a reactive dependency.
  }, [reportedUnauthorized, sessionQuery.isPending, sessionQuery.isError, sessionQuery.error, sessionQuery.data]);

  const reportUnauthorized = useCallback(() => {
    if (state.status !== "AUTHENTICATED") return;
    setReportedUnauthorized(true);
    // Pin the terminal value directly via setQueryData - deliberately NOT removeQueries()
    // followed by a fresh fetch: removing the cache entry out from under a still-mounted,
    // still-enabled observer makes TanStack Query refetch immediately to satisfy it, racing
    // this call. If that refetch resolves after this line (a real race, not hypothetical - it
    // reproduced as a hung logout E2E test locally), it would silently overwrite the correct
    // "logged out" value with a stale "still authenticated" read.
    queryClient.setQueryData(sessionQueryKey, { authenticated: false });
  }, [state.status, queryClient]);

  useEffect(() => {
    apiClient.setOnUnauthorized(reportUnauthorized);
  }, [reportUnauthorized]);

  const reauthenticate = useCallback(() => {
    const returnTo = "returnTo" in state ? state.returnTo : currentPath();
    startLogin(returnTo); // full-page navigation - nothing after this line runs
  }, [state]);

  const logout = useCallback(async () => {
    await bffLogout();
    setReportedUnauthorized(false);
    // setQueryData alone for the session key itself (see reportUnauthorized's comment for why
    // removeQueries() on an actively-observed key would race). Tenant-scoped cache (everything
    // under the "org" key prefix - items, subjects, members...) is safe to actually remove:
    // nothing should still be actively observing it once the redirect to login fires, and a
    // subsequent login must never render another tenant's - or this tenant's stale pre-logout -
    // data for a moment.
    queryClient.removeQueries({ queryKey: ["org"], exact: false });
    queryClient.setQueryData(sessionQueryKey, { authenticated: false });
  }, [queryClient]);

  const logoutEverywhere = useCallback(async () => {
    await bffLogoutAll();
    setReportedUnauthorized(false);
    queryClient.removeQueries({ queryKey: ["org"], exact: false });
    queryClient.setQueryData(sessionQueryKey, { authenticated: false });
  }, [queryClient]);

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
