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

  it("with a persistenceKey, the same key survives an unmount/remount (simulating a full-page reload mid-submission, mission §49)", async () => {
    window.sessionStorage.clear();
    const storageKey = "test:persisted-key";
    const mutationFn = vi.fn(async (_vars: { name: string }, _key: string) => ({ id: "1" }));

    const first = renderHook(() => useIdempotentMutation({ mutationFn, persistenceKey: storageKey }), { wrapper });
    const keyBeforeReload = window.sessionStorage.getItem(storageKey);
    first.unmount();

    const second = renderHook(() => useIdempotentMutation({ mutationFn, persistenceKey: storageKey }), { wrapper });
    await act(async () => {
      await second.result.current.mutateAsync({ name: "a" });
    });

    expect(keyBeforeReload).toBeTruthy();
    expect(mutationFn.mock.calls[0]?.[1]).toBe(keyBeforeReload);
  });

  it("newIntent() overwrites the persisted key too, so a genuinely new submission never reuses the old one after a reload", async () => {
    window.sessionStorage.clear();
    const storageKey = "test:persisted-key-newintent";
    const mutationFn = vi.fn(async (_vars: { name: string }, _key: string) => ({ id: "1" }));
    const { result } = renderHook(() => useIdempotentMutation({ mutationFn, persistenceKey: storageKey }), { wrapper });

    const originalKey = window.sessionStorage.getItem(storageKey);
    act(() => {
      result.current.newIntent();
    });
    const freshKey = window.sessionStorage.getItem(storageKey);

    expect(freshKey).toBeTruthy();
    expect(freshKey).not.toBe(originalKey);
  });

  it("without a persistenceKey, nothing is written to sessionStorage - the default stays purely in-memory", async () => {
    window.sessionStorage.clear();
    const mutationFn = vi.fn(async (_vars: { name: string }, _key: string) => ({ id: "1" }));
    renderHook(() => useIdempotentMutation({ mutationFn }), { wrapper });
    expect(window.sessionStorage.length).toBe(0);
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
