import { describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useIdempotentMutation } from "../../src/hooks/useIdempotentMutation.js";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useIdempotentMutation", () => {
  it("reuses the same idempotency key across repeated calls of the same intent", async () => {
    const mutationFn = vi.fn(async (_vars: { name: string }, _key: string) => ({ id: "1" }));
    const { result } = renderHook(() => useIdempotentMutation({ mutationFn }), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: "a" });
    });
    await act(async () => {
      await result.current.mutateAsync({ name: "a" });
    });

    expect(mutationFn.mock.calls[0]?.[1]).toBe(mutationFn.mock.calls[1]?.[1]);
  });

  it("generates a fresh key only after newIntent() is called - never spontaneously per retry", async () => {
    const mutationFn = vi.fn(async (_vars: { name: string }, _key: string) => ({ id: "1" }));
    const { result } = renderHook(() => useIdempotentMutation({ mutationFn }), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: "a" });
    });
    const firstKey = mutationFn.mock.calls[0]?.[1];

    act(() => {
      result.current.newIntent();
    });

    await act(async () => {
      await result.current.mutateAsync({ name: "b" });
    });
    const secondKey = mutationFn.mock.calls[1]?.[1];

    expect(secondKey).not.toBe(firstKey);
  });

  it("a failed attempt retried by the caller (no newIntent call) still reuses the original key", async () => {
    const mutationFn = vi.fn(async (_vars: { name: string }, _key: string) => ({ id: "1" }));
    mutationFn.mockRejectedValueOnce(new Error("transient"));
    const { result } = renderHook(() => useIdempotentMutation({ mutationFn }), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: "a" }).catch(() => {});
    });
    await act(async () => {
      await result.current.mutateAsync({ name: "a" });
    });

    await waitFor(() => expect(mutationFn).toHaveBeenCalledTimes(2));
    expect(mutationFn.mock.calls[0]?.[1]).toBe(mutationFn.mock.calls[1]?.[1]);
  });
});
