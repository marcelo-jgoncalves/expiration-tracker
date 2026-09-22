/**
 * D-3xx (reversal of D-320): direct-auth endpoints backing the app's own login/signup/
 * reset-password screens - replaces `session.ts`'s old `startLogin()` full-page redirect to the
 * Cognito Hosted UI as the frontend's real entry point. Same direct-fetch/no-`apiClient`
 * pattern as `organizations.ts`/`session.ts` (these are BFF-owned routes, never proxied through
 * `/bff/api/*`). No CSRF header on any of these - there is no session cookie yet to protect at
 * this point (see bff-handlers.ts's `handleLoginPassword` doc comment for the accepted
 * login-CSRF trade-off, the same one the old GET /bff/login redirect already had).
 */
import { ApiError } from "./errors.js";

async function postJson<T>(path: string, body: unknown, expectedStatus: number[]): Promise<T | undefined> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw ApiError.network(cause);
  }
  if (!expectedStatus.includes(response.status)) {
    throw ApiError.fromResponseBody(await response.json().catch(() => undefined), response.status);
  }
  if (response.status === 204) return undefined;
  return (await response.json().catch(() => undefined)) as T | undefined;
}

/** `POST /bff/login` - on success, the BFF has already set the session/CSRF cookies (same
 * shape as the old OIDC callback did); the caller just needs to know it worked. */
export async function login(input: { email: string; password: string }): Promise<void> {
  await postJson("/bff/login", input, [200]);
}

export interface SignUpResult {
  status: "CONFIRMATION_REQUIRED";
}

export async function signUp(input: { email: string; password: string }): Promise<SignUpResult> {
  const result = await postJson<SignUpResult>("/bff/signup", input, [202]);
  return result ?? { status: "CONFIRMATION_REQUIRED" };
}

export async function confirmSignUp(input: { email: string; confirmationCode: string }): Promise<void> {
  await postJson("/bff/signup/confirm", input, [204]);
}

export async function resendConfirmationCode(input: { email: string }): Promise<void> {
  await postJson("/bff/signup/resend", input, [204]);
}

/** Always resolves the same way for a registered or unregistered e-mail (anti-enumeration,
 * D-3xx decision 3) - the BFF returns 202 regardless, so this function has no way to tell the
 * caller which case happened, by design. */
export async function forgotPassword(input: { email: string }): Promise<void> {
  await postJson("/bff/forgot-password", input, [202]);
}

export async function confirmForgotPassword(input: { email: string; confirmationCode: string; newPassword: string }): Promise<void> {
  await postJson("/bff/forgot-password/confirm", input, [204]);
}
