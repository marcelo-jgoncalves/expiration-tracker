import { describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useOccMutation } from "../../src/hooks/useOccMutation.js";
import { ApiError } from "../../src/api/errors.js";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useOccMutation", () => {
  it("isConflict is true only after a CONFLICT (409) failure, never for a generic error", async () => {
    const mutationFn = vi.fn().mockRejectedValue(ApiError.fromResponseBody({ code: "CONFLICT", category: "CONFLICT", message: "stale", retryable: false }, 409));
    const { result } = renderHook(() => useOccMutation({ mutationFn }), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(undefined).catch(() => {});
    });
    await waitFor(() => expect(result.current.isConflict).toBe(true));
  });

  it("isConflict is false for a non-conflict error, even though isError is true", async () => {
    const mutationFn = vi.fn().mockRejectedValue(ApiError.network(new Error("boom")));
    const { result } = renderHook(() => useOccMutation({ mutationFn }), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(undefined).catch(() => {});
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isConflict).toBe(false);
  });

  it("isConflict is false before any failure has occurred", () => {
    const { result } = renderHook(() => useOccMutation({ mutationFn: vi.fn() }), { wrapper });
    expect(result.current.isConflict).toBe(false);
  });
});
