/**
 * D-3xx (reversal of D-320): mutation hooks for the app's own login/signup/reset-password
 * screens. `useLogin`/`useConfirmSignUp`/`useConfirmForgotPassword` all invalidate the shared
 * session query on success (same reasoning as `useCreateOrganization`/`useAcceptInvitation`) so
 * `AuthContext`/`ActiveOrganizationContext` pick up the fresh session on their next read rather
 * than assuming the mutation's own (mostly empty) response shape substitutes for it.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  login,
  signUp,
  confirmSignUp,
  resendConfirmationCode,
  forgotPassword,
  confirmForgotPassword,
  type SignUpResult,
} from "../api/auth.js";
import { sessionQueryKey } from "../api/queryKeys.js";

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation<void, unknown, { email: string; password: string }>({
    mutationFn: (input) => login(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    },
  });
}

export function useSignUp() {
  return useMutation<SignUpResult, unknown, { email: string; password: string }>({
    mutationFn: (input) => signUp(input),
  });
}

export function useConfirmSignUp() {
  return useMutation<void, unknown, { email: string; confirmationCode: string }>({
    mutationFn: (input) => confirmSignUp(input),
  });
}

export function useResendConfirmationCode() {
  return useMutation<void, unknown, { email: string }>({
    mutationFn: (input) => resendConfirmationCode(input),
  });
}

export function useForgotPassword() {
  return useMutation<void, unknown, { email: string }>({
    mutationFn: (input) => forgotPassword(input),
  });
}

export function useConfirmForgotPassword() {
  return useMutation<void, unknown, { email: string; confirmationCode: string; newPassword: string }>({
    mutationFn: (input) => confirmForgotPassword(input),
  });
}
